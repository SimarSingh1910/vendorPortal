import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import {
  isActionPending,
  SubmissionStatus,
  UserRole,
  type ProvisionEntryInput,
  type SubmissionDetail,
} from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getComments,
  getSubmission,
  recallSubmission,
  saveEntries,
  submitSubmission,
} from '@/api/submissions';
import { MonthwiseReportPanel } from '@/components/MonthwiseReportPanel';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
} from '@/components/attention';
import { apiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import {
  commentActionLabel,
  commentActionVariant,
  formatINR,
  formatIST,
  formatMonth,
  statusBadgeVariant,
  statusLabel,
} from '@/lib/format';

type ValueMap = Record<string, string>;

/** Build the values map from a freshly-loaded detail (amount string or blank). */
function seedValues(detail: SubmissionDetail): ValueMap {
  const map: ValueMap = {};
  for (const head of detail.heads) {
    map[head.snapshotId] = head.amount ?? '';
  }
  return map;
}

/** Build the per-head notes map from a freshly-loaded detail (note string or blank). */
function seedNotes(detail: SubmissionDetail): ValueMap {
  const map: ValueMap = {};
  for (const head of detail.heads) {
    map[head.snapshotId] = head.note ?? '';
  }
  return map;
}

/** A trimmed, valid non-negative number, or null if blank/invalid. */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function SubmissionEntry() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['submissions', 'detail', submissionId],
    queryFn: () => getSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['submissions', 'comments', submissionId],
    queryFn: () => getComments(submissionId),
  });

  const [values, setValues] = useState<ValueMap>({});
  // Per-head line-item notes (distinct from `note` below, the submission-level submit comment).
  const [headNotes, setHeadNotes] = useState<ValueMap>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Recall confirmation dialog (with an optional reason for the timeline).
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallReason, setRecallReason] = useState('');

  // Seed inputs whenever the detail (re)loads.
  useEffect(() => {
    if (detail) {
      setValues(seedValues(detail));
      setHeadNotes(seedNotes(detail));
    }
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  const collectEntries = (): ProvisionEntryInput[] => {
    const out: ProvisionEntryInput[] = [];
    for (const head of detail?.heads ?? []) {
      const amount = parseAmount(values[head.snapshotId] ?? '');
      // A note rides with its head's value; the API stores it on the entry row.
      if (amount !== null) {
        const noteText = (headNotes[head.snapshotId] ?? '').trim();
        out.push({ snapshotId: head.snapshotId, amount, note: noteText || undefined });
      }
    }
    return out;
  };

  const saveMutation = useMutation({
    mutationFn: () => saveEntries(submissionId, collectEntries()),
    onSuccess: (updated) => {
      setError(null);
      setValues(seedValues(updated));
      setHeadNotes(seedNotes(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save. Please try again.')),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await saveEntries(submissionId, collectEntries());
      await submitSubmission(submissionId, note);
    },
    onSuccess: () => {
      setError(null);
      setNote('');
      invalidate();
      navigate('/spoc');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not submit. Please try again.')),
  });

  // Recall: withdraw the submission back to DRAFT. On success it becomes editable
  // (canEdit flips true) and drops out of the reviewer queues — invalidate so the
  // SPOC view refetches as editable and any queue views the SPOC holds refresh.
  const recallMutation = useMutation({
    mutationFn: () => recallSubmission(submissionId, recallReason),
    onSuccess: () => {
      setError(null);
      setRecallReason('');
      setRecallOpen(false);
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not recall. Please try again.')),
  });

  const missingCount = useMemo(() => {
    if (!detail) return 0;
    return detail.heads.filter((h) => parseAmount(values[h.snapshotId] ?? '') === null).length;
  }, [detail, values]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const canEdit = detail.canEdit;
  const isSentBack =
    detail.status === SubmissionStatus.SENT_BACK_BY_MANAGER ||
    detail.status === SubmissionStatus.SENT_BACK_BY_FINANCE;
  // Awaiting this SPOC's entry/resubmission (Step 6 emphasis).
  const pending = isActionPending(UserRole.CLINIC_SPOC, detail.status);
  const busy = saveMutation.isPending || submitMutation.isPending || recallMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/spoc">
          <ArrowLeft />
          Back to my clinics
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{detail.clinicName}</h1>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xl font-semibold text-foreground">{formatMonth(detail.month)}</p>
          <div className="flex items-center gap-2">
            {detail.locked && <Lock className="size-4 text-muted-foreground" />}
            {pending && <ActionNeededBadge />}
            <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
          </div>
        </div>
      </div>

      {isSentBack && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This submission was sent back for revision. Review the comments below, update the values
          and resubmit.
        </div>
      )}

      {pending && !isSentBack && (
        <AttentionBanner>
          Action needed — enter this month&rsquo;s figures for every expense head and submit for
          review.
        </AttentionBanner>
      )}

      {comments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Review history</h2>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {c.commentedBy.name}{' '}
                    <Badge variant={commentActionVariant(c.action)}>
                      {commentActionLabel(c.action)}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatIST(c.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-base text-foreground">{c.comment}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={cn('rounded-lg border', pending && attentionAccentClass)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Expense head</TableHead>
              <TableHead className="text-right">Amount (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.heads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No expense heads are mapped to this clinic. Contact Finance.
                </TableCell>
              </TableRow>
            ) : (
              detail.heads.map((head) => (
                <TableRow key={head.snapshotId}>
                  <TableCell className="align-top text-muted-foreground">{head.category}</TableCell>
                  <TableCell className="align-top font-medium">
                    <div>{head.name}</div>
                    {canEdit ? (
                      <Textarea
                        rows={2}
                        placeholder="Add a note for this head (optional) — e.g. why it changed this month."
                        className="mt-1.5 text-sm font-normal"
                        value={headNotes[head.snapshotId] ?? ''}
                        onChange={(e) =>
                          setHeadNotes((prev) => ({ ...prev, [head.snapshotId]: e.target.value }))
                        }
                      />
                    ) : (
                      head.note && (
                        <p className="mt-1 whitespace-pre-wrap text-xs font-normal text-muted-foreground">
                          {head.note}
                        </p>
                      )
                    )}
                  </TableCell>
                  <TableCell className="align-top text-right">
                    {canEdit ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="ml-auto w-40 text-right"
                        value={values[head.snapshotId] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [head.snapshotId]: e.target.value }))
                        }
                      />
                    ) : (
                      <span className={head.amount === null ? 'text-muted-foreground' : ''}>
                        {formatINR(head.amount)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {canEdit && (
        <div className="space-y-1.5">
          <Label htmlFor="submit-note">Note for reviewers (optional)</Label>
          <Textarea
            id="submit-note"
            rows={3}
            placeholder="Add a note for the manager / finance reviewer — e.g. why a head spiked or dropped this month."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Saved to the review timeline when you submit. Leave blank for no note.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            disabled={busy || detail.heads.length === 0 || missingCount > 0}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit for review'}
          </Button>
          {missingCount > 0 && (
            <span className="text-xs text-muted-foreground">
              Fill every head before submitting ({missingCount} blank). Zero is a valid value.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {detail.locked
              ? 'This month is approved and locked — read only.'
              : 'This submission is under review — read only.'}
          </p>
          {detail.canRecall && (
            <Button variant="outline" disabled={busy} onClick={() => setRecallOpen(true)}>
              Recall submission
            </Button>
          )}
        </div>
      )}

      {/* Recall confirmation — withdraws the submission to DRAFT for corrections. */}
      <Dialog open={recallOpen} onOpenChange={(open) => !busy && setRecallOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recall this submission?</DialogTitle>
            <DialogDescription>
              It will return to <span className="font-medium">Draft</span> and become editable
              again. Your entered figures are kept. It will be removed from the reviewer&rsquo;s
              queue and must be re-submitted to flow through manager and finance review again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="recall-reason">Reason (optional)</Label>
            <Textarea
              id="recall-reason"
              rows={3}
              placeholder="e.g. recalled to fix a data-entry error."
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Added to the review timeline so reviewers see why it was withdrawn.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRecallOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => recallMutation.mutate()}>
              {recallMutation.isPending ? 'Recalling…' : 'Recall submission'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MonthwiseReportPanel clinicId={detail.clinicId} />
    </div>
  );
}

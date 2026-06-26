import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import {
  CorpSubmissionStatus,
  type CorpProvisionEntryInput,
  type CorpSubmissionDetail,
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
import { getCorpComments, getCorpSubmission, saveCorpEntries, submitCorpSubmission } from '@/api/corpSubmissions';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
} from '@/components/attention';
import { apiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { commentActionLabel, commentActionVariant, formatINR, formatIST, formatMonth } from '@/lib/format';
import { corpStatusBadgeVariant, corpStatusLabel, isCorpSpocActionPending } from '@/lib/corpFormat';

type ValueMap = Record<string, string>;

function seedValues(detail: CorpSubmissionDetail): ValueMap {
  const map: ValueMap = {};
  for (const head of detail.heads) map[head.snapshotId] = head.amount ?? '';
  return map;
}

function seedCodes(detail: CorpSubmissionDetail): ValueMap {
  const map: ValueMap = {};
  for (const head of detail.heads) map[head.snapshotId] = head.budgetCodeId ?? '';
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

/** Native styled select, matching the Input look (no shared Select component exists). */
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export function CorpSubmissionEntry() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['corp', 'detail', submissionId],
    queryFn: () => getCorpSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['corp', 'comments', submissionId],
    queryFn: () => getCorpComments(submissionId),
  });

  const [values, setValues] = useState<ValueMap>({});
  const [codes, setCodes] = useState<ValueMap>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) {
      setValues(seedValues(detail));
      setCodes(seedCodes(detail));
    }
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['corp'] });
  };

  // Only lines with BOTH a budget code and a valid amount are persisted (BR-C01);
  // incomplete lines are omitted (a partial draft), never sent half-filled.
  const collectEntries = (): CorpProvisionEntryInput[] => {
    const out: CorpProvisionEntryInput[] = [];
    for (const head of detail?.heads ?? []) {
      const amount = parseAmount(values[head.snapshotId] ?? '');
      const budgetCodeId = (codes[head.snapshotId] ?? '').trim();
      if (amount !== null && budgetCodeId) {
        out.push({ snapshotId: head.snapshotId, budgetCodeId, amount });
      }
    }
    return out;
  };

  const saveMutation = useMutation({
    mutationFn: () => saveCorpEntries(submissionId, collectEntries()),
    onSuccess: (updated) => {
      setError(null);
      setValues(seedValues(updated));
      setCodes(seedCodes(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save. Please try again.')),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await saveCorpEntries(submissionId, collectEntries());
      await submitCorpSubmission(submissionId, note);
    },
    onSuccess: () => {
      setError(null);
      setNote('');
      invalidate();
      navigate('/corporate');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not submit. Please try again.')),
  });

  // A head is incomplete unless it has BOTH a budget code and a valid amount.
  const missingCount = useMemo(() => {
    if (!detail) return 0;
    return detail.heads.filter(
      (h) => parseAmount(values[h.snapshotId] ?? '') === null || !(codes[h.snapshotId] ?? '').trim(),
    ).length;
  }, [detail, values, codes]);

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const canEdit = detail.canEdit;
  const isSentBack = detail.status === CorpSubmissionStatus.SENT_BACK_TO_SPOC;
  const pending = isCorpSpocActionPending(detail.status) && !!detail.canEdit;
  const isPool = detail.isSharedCostPool;
  const busy = saveMutation.isPending || submitMutation.isPending;
  const colSpan = isPool ? 4 : 3;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/corporate">
          <ArrowLeft />
          Back to my departments
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{detail.departmentName}</h1>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xl font-semibold text-foreground">{formatMonth(detail.month)}</p>
          <div className="flex items-center gap-2">
            {detail.locked && <Lock className="size-4 text-muted-foreground" />}
            {pending && <ActionNeededBadge />}
            <Badge variant={corpStatusBadgeVariant(detail.status)}>
              {corpStatusLabel(detail.status)}
            </Badge>
          </div>
        </div>
      </div>

      {isPool && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Sec 24 shared-cost pool — HCL Avitas share is{' '}
          {detail.sec24AllocationPct !== null ? (
            <span className="font-medium text-foreground">{detail.sec24AllocationPct}%</span>
          ) : (
            <span className="font-medium text-foreground">not set yet (—)</span>
          )}{' '}
          of each provision. The share is computed and frozen on approval.
        </div>
      )}

      {isSentBack && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This submission was sent back for revision. Review the comments below, update the values
          and resubmit.
        </div>
      )}

      {pending && !isSentBack && (
        <AttentionBanner>
          Action needed — enter a budget code and amount for every expense head and submit for
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
              <TableHead>Expense head</TableHead>
              <TableHead>Budget code</TableHead>
              <TableHead className="text-right">Amount (₹)</TableHead>
              {isPool && <TableHead className="text-right">HCL Avitas share (₹)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.heads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
                  No expense heads are active for this department. Contact Finance.
                </TableCell>
              </TableRow>
            ) : (
              detail.heads.map((head) => (
                <TableRow key={head.snapshotId}>
                  <TableCell className="align-top font-medium">{head.name}</TableCell>
                  <TableCell className="align-top">
                    {canEdit ? (
                      <select
                        className={selectClass}
                        value={codes[head.snapshotId] ?? ''}
                        onChange={(e) =>
                          setCodes((prev) => ({ ...prev, [head.snapshotId]: e.target.value }))
                        }
                      >
                        <option value="">— select budget code —</option>
                        {detail.budgetCodes.map((bc) => (
                          <option key={bc.id} value={bc.id}>
                            {bc.code}
                            {bc.description ? ` — ${bc.description}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={head.budgetCodeId === null ? 'text-muted-foreground' : ''}>
                        {detail.budgetCodes.find((b) => b.id === head.budgetCodeId)?.code ?? '—'}
                      </span>
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
                  {isPool && (
                    <TableCell className="align-top text-right text-muted-foreground">
                      {/* Frozen share from the API — NEVER recomputed; null renders "—". */}
                      {formatINR(head.hclAvitasShare)}
                    </TableCell>
                  )}
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
            placeholder="Add a note for the corporate finance reviewer — e.g. why a head changed this month."
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
              Every head needs a budget code and amount before submitting ({missingCount}{' '}
              incomplete). Zero is a valid amount.
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {detail.locked
            ? 'This month is approved and locked — read only.'
            : 'This submission is under review — read only.'}
        </p>
      )}
    </div>
  );
}

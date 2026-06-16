import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import {
  SubmissionStatus,
  type ProvisionEntryInput,
  type SubmissionDetail,
} from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getComments, getSubmission, saveEntries, submitSubmission } from '@/api/submissions';
import { apiErrorMessage } from '@/lib/apiError';
import { formatINR, formatIST, formatMonth, statusBadgeVariant, statusLabel } from '@/lib/format';

type ValueMap = Record<string, string>;

/** Build the values map from a freshly-loaded detail (amount string or blank). */
function seedValues(detail: SubmissionDetail): ValueMap {
  const map: ValueMap = {};
  for (const head of detail.heads) {
    map[head.snapshotId] = head.amount ?? '';
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
  const [error, setError] = useState<string | null>(null);

  // Seed inputs whenever the detail (re)loads.
  useEffect(() => {
    if (detail) setValues(seedValues(detail));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  const collectEntries = (): ProvisionEntryInput[] => {
    const out: ProvisionEntryInput[] = [];
    for (const head of detail?.heads ?? []) {
      const amount = parseAmount(values[head.snapshotId] ?? '');
      if (amount !== null) out.push({ snapshotId: head.snapshotId, amount });
    }
    return out;
  };

  const saveMutation = useMutation({
    mutationFn: () => saveEntries(submissionId, collectEntries()),
    onSuccess: (updated) => {
      setError(null);
      setValues(seedValues(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save. Please try again.')),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await saveEntries(submissionId, collectEntries());
      await submitSubmission(submissionId);
    },
    onSuccess: () => {
      setError(null);
      invalidate();
      navigate('/spoc');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not submit. Please try again.')),
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
  const busy = saveMutation.isPending || submitMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/spoc">
          <ArrowLeft />
          Back to my clinics
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.clinicName}</h1>
          <p className="text-sm text-muted-foreground">{formatMonth(detail.month)}</p>
        </div>
        <div className="flex items-center gap-2">
          {detail.locked && <Lock className="size-4 text-muted-foreground" />}
          <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
        </div>
      </div>

      {isSentBack && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This submission was sent back for revision. Review the comments below, update the values
          and resubmit.
        </div>
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
                    <Badge variant={c.action === 'SENT_BACK' ? 'secondary' : 'success'}>
                      {c.action === 'SENT_BACK' ? 'Sent back' : 'Approved'}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatIST(c.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.comment}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="rounded-lg border">
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
                  <TableCell className="text-muted-foreground">{head.category}</TableCell>
                  <TableCell className="font-medium">{head.name}</TableCell>
                  <TableCell className="text-right">
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
        <p className="text-sm text-muted-foreground">
          {detail.locked
            ? 'This month is approved and locked — read only.'
            : 'This submission is under review — read only.'}
        </p>
      )}
    </div>
  );
}

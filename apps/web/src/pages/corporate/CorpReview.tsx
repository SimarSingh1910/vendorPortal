import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import {
  CorpSubmissionStatus,
  UserRole,
  type CorpProvisionEntryInput,
  type CorpSubmissionDetail,
} from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  corpApprove,
  corpOpenReview,
  corpSendBack,
  corpUnlock,
  getCorpComments,
  getCorpSubmission,
  saveCorpEntries,
} from '@/api/corpSubmissions';
import { useAuthStore } from '@/store/auth.store';
import { apiErrorMessage } from '@/lib/apiError';
import { commentActionLabel, commentActionVariant, formatINR, formatIST, formatMonth } from '@/lib/format';
import { corpStatusBadgeVariant, corpStatusLabel } from '@/lib/corpFormat';

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

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export function CorpReview() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isApprover = role === UserRole.FINANCE_ADMIN || role === UserRole.CORP_FINANCE_MANAGER;
  const isAdmin = role === UserRole.FINANCE_ADMIN;

  const [comment, setComment] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const [values, setValues] = useState<ValueMap>({});
  const [codes, setCodes] = useState<ValueMap>({});
  const [error, setError] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['corp', 'detail', submissionId],
    queryFn: () => getCorpSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['corp', 'comments', submissionId],
    queryFn: () => getCorpComments(submissionId),
  });

  useEffect(() => {
    if (detail) {
      setValues(seedValues(detail));
      setCodes(seedCodes(detail));
    }
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['corp'] });
  };

  // An approver opening a SUBMITTED item moves it to FINANCE_MANAGER_REVIEW (stamps who/when).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!detail || openedRef.current || !isApprover) return;
    if (detail.status === CorpSubmissionStatus.SUBMITTED) {
      openedRef.current = true;
      corpOpenReview(submissionId)
        .then(invalidate)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, submissionId, isApprover]);

  // Override lines must carry BOTH a budget code and a valid amount (BR-C01);
  // incomplete lines are omitted from the payload.
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

  const overrideMutation = useMutation({
    mutationFn: () => saveCorpEntries(submissionId, collectEntries()),
    onSuccess: (updated) => {
      setError(null);
      setValues(seedValues(updated));
      setCodes(seedCodes(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save override. Please try again.')),
  });

  const approveMutation = useMutation({
    mutationFn: () => corpApprove(submissionId, comment.trim() || undefined),
    onSuccess: () => {
      invalidate();
      navigate('/corporate/review');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not approve. Please try again.')),
  });

  const sendBackMutation = useMutation({
    mutationFn: () => corpSendBack(submissionId, comment.trim()),
    onSuccess: () => {
      invalidate();
      navigate('/corporate/review');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send back. Please try again.')),
  });

  const unlockMutation = useMutation({
    mutationFn: () => corpUnlock(submissionId, unlockReason.trim()),
    onSuccess: () => {
      setError(null);
      setUnlockReason('');
      invalidate(); // status flips to FINANCE_MANAGER_REVIEW; screen re-renders editable
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not unlock. Please try again.')),
  });

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const canEdit = detail.canReview;
  const inReview = detail.status === CorpSubmissionStatus.FINANCE_MANAGER_REVIEW;
  const isPool = detail.isSharedCostPool;
  const colSpan = isPool ? 4 : 3;
  const busy =
    approveMutation.isPending ||
    sendBackMutation.isPending ||
    overrideMutation.isPending ||
    unlockMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/corporate/review">
          <ArrowLeft />
          Back to review queue
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{detail.departmentName}</h1>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xl font-semibold text-foreground">{formatMonth(detail.month)}</p>
          <div className="flex items-center gap-2">
            {detail.locked && <Lock className="size-4 text-muted-foreground" />}
            <Badge variant={corpStatusBadgeVariant(detail.status)}>
              {corpStatusLabel(detail.status)}
            </Badge>
          </div>
        </div>
      </div>

      {detail.submittedAt && (
        <p className="text-xs text-muted-foreground">Submitted {formatIST(detail.submittedAt)}</p>
      )}

      {isPool && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          Sec 24 shared-cost pool — allocation{' '}
          {detail.sec24AllocationPct !== null ? (
            <span className="font-medium text-foreground">{detail.sec24AllocationPct}%</span>
          ) : (
            <span className="font-medium text-foreground">not set yet (—)</span>
          )}
          . The HCL Avitas share below is frozen on approval.
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

      <div className="rounded-lg border">
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
                  No expense heads on this submission.
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
                      {formatINR(head.hclAvitasShare)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => overrideMutation.mutate()}>
            {overrideMutation.isPending ? 'Saving…' : 'Save override'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Edits during review are audit-logged. Each line keeps a budget code and amount.
          </span>
        </div>
      )}

      {isApprover && detail.locked && isAdmin && (
        <section className="space-y-3 border-t pt-4">
          <h2 className="text-sm font-medium">Unlock for correction</h2>
          <Textarea
            placeholder="Reason for unlocking (required)…"
            value={unlockReason}
            onChange={(e) => setUnlockReason(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              disabled={busy || unlockReason.trim() === ''}
              onClick={() => unlockMutation.mutate()}
            >
              {unlockMutation.isPending ? 'Unlocking…' : 'Unlock'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Finance Admin only. Reopens editing and is audit-logged. Re-approve to re-lock.
            </span>
          </div>
        </section>
      )}

      {isApprover && detail.locked && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Approved and locked. Only a Finance Admin can unlock for correction.
        </p>
      )}

      {canEdit && inReview && (
        <section className="space-y-3 border-t pt-4">
          <Textarea
            placeholder="Comment (required to send back, optional when approving)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending ? 'Approving…' : 'Approve & lock'}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || comment.trim() === ''}
              onClick={() => sendBackMutation.mutate()}
            >
              {sendBackMutation.isPending ? 'Sending back…' : 'Send back to SPOC'}
            </Button>
            {comment.trim() === '' && (
              <span className="self-center text-xs text-muted-foreground">
                A comment is required to send back.
              </span>
            )}
          </div>
        </section>
      )}

      {!isApprover && (
        <p className="text-sm text-muted-foreground">
          {detail.locked ? 'Approved and locked — read only.' : 'Read only.'}
        </p>
      )}
    </div>
  );
}

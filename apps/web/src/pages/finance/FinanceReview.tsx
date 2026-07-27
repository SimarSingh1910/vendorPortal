import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import { SubmissionStatus, UserRole } from '@portal/shared';
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
  financeApprove,
  financeOpenReview,
  financeSendBack,
  financeUnlock,
  getComments,
  getSubmission,
  saveEntries,
} from '@/api/submissions';
import { useAuthStore } from '@/store/auth.store';
import { apiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { collectOverrideEntries, seedLines, type LinesState } from '@/lib/provisionLines';
import {
  commentActionLabel,
  commentActionVariant,
  formatINR,
  formatIST,
  formatMonth,
  statusBadgeVariant,
  statusLabel,
} from '@/lib/format';
import { MonthwiseReportPanel } from '@/components/MonthwiseReportPanel';

export function FinanceReview() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  // Both finance roles have identical authority over the workflow (open, approve,
  // unlock, value override); only user management differs (not on this screen).
  const isFinanceApprover =
    role === UserRole.FINANCE_ADMIN || role === UserRole.FINANCE_MANAGER;

  const [comment, setComment] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const [lines, setLines] = useState<LinesState>({});
  const [error, setError] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['submissions', 'detail', submissionId],
    queryFn: () => getSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['submissions', 'comments', submissionId],
    queryFn: () => getComments(submissionId),
  });

  useEffect(() => {
    if (detail) setLines(seedLines(detail));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  const patchAmount = (snapshotId: string, index: number, amount: string) => {
    setLines((prev) => ({
      ...prev,
      [snapshotId]: (prev[snapshotId] ?? []).map((l, i) => (i === index ? { ...l, amount } : l)),
    }));
  };

  // A finance approver opening a clinic-approved item moves it to FINANCE_REVIEW (stamps who/when).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!detail || openedRef.current || !isFinanceApprover) return;
    if (detail.status === SubmissionStatus.CLINIC_APPROVED) {
      openedRef.current = true;
      financeOpenReview(submissionId)
        .then(invalidate)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, submissionId, isFinanceApprover]);

  const overrideMutation = useMutation({
    mutationFn: () => saveEntries(submissionId, collectOverrideEntries(detail!, lines)),
    onSuccess: (updated) => {
      setError(null);
      setLines(seedLines(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save override. Please try again.')),
  });

  const approveMutation = useMutation({
    mutationFn: () => financeApprove(submissionId, comment.trim() || undefined),
    onSuccess: () => {
      invalidate();
      navigate('/finance');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not approve. Please try again.')),
  });

  const sendBackMutation = useMutation({
    mutationFn: () => financeSendBack(submissionId, comment.trim()),
    onSuccess: () => {
      invalidate();
      navigate('/finance');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send back. Please try again.')),
  });

  const unlockMutation = useMutation({
    mutationFn: () => financeUnlock(submissionId, unlockReason.trim()),
    onSuccess: () => {
      setError(null);
      setUnlockReason('');
      invalidate(); // status flips to FINANCE_REVIEW; the screen re-renders editable
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not unlock. Please try again.')),
  });

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const inReview = detail.status === SubmissionStatus.FINANCE_REVIEW;
  const busy =
    approveMutation.isPending ||
    sendBackMutation.isPending ||
    overrideMutation.isPending ||
    unlockMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/finance">
          <ArrowLeft />
          Back to finance queue
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{detail.clinicName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acc. Location Code:{' '}
            <span className="font-medium text-foreground">{detail.clinicAccLocationCode}</span>
            {' · '}
            Customer Code:{' '}
            <span className="font-medium text-foreground">{detail.clinicCustomerCode}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xl font-semibold text-foreground">{formatMonth(detail.month)}</p>
          <div className="flex items-center gap-2">
            {detail.locked && <Lock className="size-4 text-muted-foreground" />}
            <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
          </div>
        </div>
      </div>

      {detail.reviewStartedAt && (
        <p className="text-xs text-muted-foreground">
          In review since {formatIST(detail.reviewStartedAt)}
          {detail.reviewStartedByName ? ` · opened by ${detail.reviewStartedByName}` : ''}
        </p>
      )}

      {detail.unlockedReason && (
        <div className="rounded-lg border border-warning-foreground/25 bg-warning p-3 text-sm text-warning-foreground">
          <span className="font-medium">Unlocked for correction:</span> {detail.unlockedReason}
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
              <TableHead>G/L Account No.</TableHead>
              <TableHead>G/L Account Name</TableHead>
              <TableHead>Vendor Name</TableHead>
              <TableHead>Product Code</TableHead>
              <TableHead className="text-right">Amount (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.heads.map((head) => {
              const headLines = lines[head.snapshotId] ?? [];
              return (
                <Fragment key={head.snapshotId}>
                  {headLines.map((line, li) => (
                    <TableRow
                      key={line.entryId ?? `line-${li}`}
                      className={li > 0 ? 'border-t-0' : undefined}
                    >
                      <TableCell className="align-top text-muted-foreground">
                        {li === 0 ? head.glAccountNo : ''}
                      </TableCell>
                      <TableCell className="align-top font-medium">
                        {li === 0 ? (
                          <div>{head.glAccountName}</div>
                        ) : (
                          <div className="pl-4 text-muted-foreground">↳</div>
                        )}
                        {line.note && (
                          <p
                            className={cn(
                              'mt-1 whitespace-pre-wrap text-xs font-normal text-muted-foreground',
                              li > 0 && 'ml-4',
                            )}
                          >
                            <span className="font-medium">SPOC note:</span> {line.note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {line.vendor}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {line.product}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {isFinanceApprover ? (
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="ml-auto w-40 text-right"
                            value={line.amount}
                            onChange={(e) => patchAmount(head.snapshotId, li, e.target.value)}
                          />
                        ) : (
                          formatINR(line.amount === '' ? null : line.amount)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isFinanceApprover && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => overrideMutation.mutate()}>
            {overrideMutation.isPending ? 'Saving…' : 'Save override'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Finance Admin edits apply at any status and are audit-logged.
          </span>
        </div>
      )}

      {isFinanceApprover && detail.locked && (
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
              Reopens editing and is audit-logged. Re-approve afterwards to re-lock.
            </span>
          </div>
        </section>
      )}

      {isFinanceApprover && inReview ? (
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
              {sendBackMutation.isPending ? 'Sending back…' : 'Send back to clinic'}
            </Button>
            {comment.trim() === '' && (
              <span className="self-center text-xs text-muted-foreground">
                A comment is required to send back.
              </span>
            )}
          </div>
        </section>
      ) : (
        !isFinanceApprover && (
          <p className="text-sm text-muted-foreground">
            {detail.locked ? 'Approved and locked — read only.' : 'Read only.'}
          </p>
        )
      )}

      <MonthwiseReportPanel clinicId={detail.clinicId} />
    </div>
  );
}

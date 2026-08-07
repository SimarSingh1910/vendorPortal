import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { productCodeLabel, SubmissionStatus } from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  getComments,
  getSubmission,
  managerApprove,
  managerOpenReview,
  managerSendBack,
  saveEntries,
} from '@/api/submissions';
import { apiErrorMessage } from '@/lib/apiError';
import { AttachPicker, AttachmentList } from '@/components/CommentAttachments';
import { cn } from '@/lib/utils';
import {
  collectOverrideEntries,
  headAmountMinor,
  lineAmountMinor,
  minorToAmountString,
  seedLines,
  type LinesState,
  type ParticularDraft,
} from '@/lib/provisionLines';
import { ParticularsTable } from '@/components/ProvisionParticulars';
import {
  HEAD_AMOUNT,
  HEAD_ROW,
  HEAD_TEXT,
  LINE_AMOUNT,
  PARTICULARS_ROW,
  TOTAL_ROW,
  VENDOR_ROW,
} from '@/components/provisionTableStyles';
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
import {
  HEAD_HIGHLIGHT_CELL,
  HEAD_HIGHLIGHT_ROW,
  HEAD_JUMP_BUTTON,
  headAnchorId,
  reportHeadAnchorId,
  useHeadHighlight,
} from '@/lib/headHighlight';

export function ManagerReview() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  // Proof files for the comment being composed. Editable only until it is
  // submitted — afterwards attachments are fixed.
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<LinesState>({});
  const [error, setError] = useState<string | null>(null);
  // Chart → table jump: clicking a G/L head in the month-wise chart below scrolls to
  // and briefly highlights that head's block above. Navigation only — no data change.
  const { highlightedHeadId, highlightHead } = useHeadHighlight();
  // The reverse jump: clicking this table's G/L number/name drops to that head's row
  // in the trend report below, so a figure can be checked against its own history in
  // one click. A separate instance so the two highlights never fight.
  const {
    highlightedHeadId: trendHeadId,
    highlightNonce: trendNonce,
    highlightHead: jumpToTrend,
  } = useHeadHighlight(reportHeadAnchorId);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['submissions', 'detail', submissionId],
    queryFn: () => getSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['submissions', 'comments', submissionId],
    queryFn: () => getComments(submissionId),
  });

  // Seed the editable lines whenever the detail (re)loads.
  useEffect(() => {
    if (detail) setLines(seedLines(detail));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  /**
   * The override now edits a PARTICULAR (its name, rate or quantity) rather than a
   * head amount — that is where values live. Every total above it re-derives, on
   * screen here and again server-side on save, so a reviewer can never leave a head
   * amount that contradicts the particulars it is supposed to be the sum of.
   */
  const patchParticular = (
    snapshotId: string,
    lineIndex: number,
    particularIndex: number,
    patch: Partial<ParticularDraft>,
  ) => {
    setLines((prev) => ({
      ...prev,
      [snapshotId]: (prev[snapshotId] ?? []).map((l, i) =>
        i === lineIndex
          ? {
              ...l,
              particulars: l.particulars.map((p, j) =>
                j === particularIndex ? { ...p, ...patch } : p,
              ),
            }
          : l,
      ),
    }));
  };

  // Manager value override → writes the canonical entries per line (audited);
  // everyone sees the new value on refetch (queries invalidated).
  const overrideMutation = useMutation({
    mutationFn: () => saveEntries(submissionId, collectOverrideEntries(detail!, lines)),
    onSuccess: (updated) => {
      setError(null);
      setLines(seedLines(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save override. Please try again.')),
  });

  // Opening the item moves SUBMITTED → CLINIC_MANAGER_REVIEW (stamps who/when).
  // Fire once; ignore a 409 if it's already in review (e.g. StrictMode re-mount).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!detail || openedRef.current) return;
    if (detail.status === SubmissionStatus.SUBMITTED) {
      openedRef.current = true;
      managerOpenReview(submissionId)
        .then(invalidate)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, submissionId]);

  const approveMutation = useMutation({
    mutationFn: () => managerApprove(submissionId, comment.trim() || undefined, attachFiles),
    onSuccess: () => {
      invalidate();
      navigate('/manager');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not approve. Please try again.')),
  });

  const sendBackMutation = useMutation({
    mutationFn: () => managerSendBack(submissionId, comment.trim(), attachFiles),
    onSuccess: () => {
      invalidate();
      navigate('/manager');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send back. Please try again.')),
  });

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const inReview = detail.status === SubmissionStatus.CLINIC_MANAGER_REVIEW;
  // The manager may override values during their review stage (own clinic).
  const canOverride =
    detail.status === SubmissionStatus.SUBMITTED ||
    detail.status === SubmissionStatus.CLINIC_MANAGER_REVIEW;
  const busy =
    approveMutation.isPending || sendBackMutation.isPending || overrideMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/manager">
          <ArrowLeft />
          Back to review queue
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
            {' · '}
            Customer:{' '}
            <span className="font-medium text-foreground">{detail.clinicCustomerName}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xl font-semibold text-foreground">{formatMonth(detail.month)}</p>
          <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
        </div>
      </div>

      {detail.reviewStartedAt && (
        <p className="text-xs text-muted-foreground">
          In review since {formatIST(detail.reviewStartedAt)}
          {detail.reviewStartedByName ? ` · opened by ${detail.reviewStartedByName}` : ''}
        </p>
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
                <AttachmentList attachments={c.attachments} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Entry data. The manager may override values during their review stage;
          the edit writes the canonical entries and is audit-logged. */}
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
              const headTotal = minorToAmountString(headAmountMinor(headLines));
              // Highlighted by a click on this head in the chart below.
              const lit = highlightedHeadId === head.expenseHeadId;
              return (
                <Fragment key={head.snapshotId}>
                  {headLines.map((line, li) => {
                    const lineAmount = minorToAmountString(lineAmountMinor(line));
                    return (
                    <Fragment key={line.entryId ?? `line-${li}`}>
                    <TableRow className={cn(li === 0 ? HEAD_ROW : VENDOR_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                      <TableCell
                        // Scroll target for this head, keyed by expense-head id.
                        id={li === 0 ? headAnchorId(head.expenseHeadId) : undefined}
                        className={cn(
                          'scroll-mt-24 align-top',
                          li === 0 ? HEAD_TEXT : 'text-muted-foreground',
                          lit && HEAD_HIGHLIGHT_CELL,
                        )}
                      >
                        {/* Both G/L cells jump DOWN to this head's row in the
                            trend report — read-only navigation, nothing is
                            selected or saved. Only on the head row (li === 0),
                            which is the only one that names the G/L. */}
                        {li === 0 && (
                          <button
                            type="button"
                            className={HEAD_JUMP_BUTTON}
                            title={`See ${head.glAccountName} in the month-wise report below`}
                            onClick={() => jumpToTrend(head.expenseHeadId)}
                          >
                            {head.glAccountNo}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className={cn('align-top', li === 0 ? HEAD_TEXT : 'font-medium')}>
                        {li === 0 ? (
                          <button
                            type="button"
                            className={HEAD_JUMP_BUTTON}
                            title={`See ${head.glAccountName} in the month-wise report below`}
                            onClick={() => jumpToTrend(head.expenseHeadId)}
                          >
                            {head.glAccountName}
                          </button>
                        ) : (
                          <div className="pl-4 text-muted-foreground">↳</div>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {line.vendor}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {line.product ? productCodeLabel(line.product) : ''}
                      </TableCell>
                      {/* Derived vendor-line subtotal — never an input, in either mode. */}
                      <TableCell className="align-top text-right">
                        <span
                          className={cn(
                            headLines.length === 1 ? HEAD_AMOUNT : LINE_AMOUNT,
                            lineAmount === null && 'font-normal text-muted-foreground',
                          )}
                        >
                          {formatINR(lineAmount)}
                        </span>
                      </TableCell>
                    </TableRow>
                    {/* The particulars behind that subtotal — the level a reviewer
                        overrides at, and where the SPOC's per-row Remark is shown
                        read-only (it replaced the line-level note that used to sit
                        in the G/L Account Name cell). Laid out exactly as on the
                        entry screen: flush under G/L Account Name, full width. */}
                    <TableRow className={cn(PARTICULARS_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                      <TableCell className={cn(lit && HEAD_HIGHLIGHT_CELL)} />
                      <TableCell colSpan={4} className="py-2 pr-4">
                        <ParticularsTable
                          particulars={line.particulars}
                          editable={canOverride}
                          onPatch={(pi, patch) => patchParticular(head.snapshotId, li, pi, patch)}
                          // A reviewer overrides existing particulars; adding or
                          // removing rows — and the remark itself — stay with the
                          // SPOC, so these are no-ops and their controls are hidden.
                          onAdd={() => {}}
                          onRemove={() => {}}
                          allowAddRemove={false}
                        />
                      </TableCell>
                    </TableRow>
                    </Fragment>
                    );
                  })}
                  {headLines.length > 1 && (
                    <TableRow className={cn(TOTAL_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                      <TableCell className={cn(lit && HEAD_HIGHLIGHT_CELL)} />
                      <TableCell colSpan={3} className="py-2 text-right text-sm font-semibold">
                        Total — {head.glAccountName}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <span
                          className={cn(
                            HEAD_AMOUNT,
                            headTotal === null && 'font-normal text-muted-foreground',
                          )}
                        >
                          {formatINR(headTotal)}
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canOverride && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => overrideMutation.mutate()}>
            {overrideMutation.isPending ? 'Saving…' : 'Save override'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Edit a particular&rsquo;s rate or quantity — the line and head totals re-calculate
            from it. Applies during your review and is audit-logged.
          </span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {inReview ? (
        <section className="space-y-3">
          <Textarea
            placeholder="Comment (required to send back, optional when approving)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <AttachPicker files={attachFiles} onChange={setAttachFiles} disabled={busy} />
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || comment.trim() === ''}
              onClick={() => sendBackMutation.mutate()}
            >
              {sendBackMutation.isPending ? 'Sending back…' : 'Send back'}
            </Button>
            {comment.trim() === '' && (
              <span className="self-center text-xs text-muted-foreground">
                A comment is required to send back.
              </span>
            )}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          This submission is {statusLabel(detail.status).toLowerCase()} — no action available.
        </p>
      )}

      <MonthwiseReportPanel
        clinicId={detail.clinicId}
        onHeadClick={highlightHead}
        highlightedHeadId={trendHeadId}
        highlightNonce={trendNonce}
      />
    </div>
  );
}

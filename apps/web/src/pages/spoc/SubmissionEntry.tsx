import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Lock, Plus, X } from 'lucide-react';
import {
  isActionPending,
  PRODUCT_CODES,
  productCodeLabel,
  SubmissionStatus,
  UserRole,
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
import { ActionNeededBadge } from '@/components/attention';
import { apiErrorMessage } from '@/lib/apiError';
import { AttachmentList } from '@/components/CommentAttachments';
import { cn } from '@/lib/utils';
import {
  blankLine,
  blankParticular,
  collectSpocEntries,
  headAmountMinor,
  incompleteHeadCount,
  lineAmountMinor,
  minorToAmountString,
  particularHasData,
  seedLines,
  type LineDraft,
  type LinesState,
  type ParticularDraft,
} from '@/lib/provisionLines';
import { ParticularsTable } from '@/components/ProvisionParticulars';
import {
  ADD_ROW,
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

/** Native styled select, matching the Input look (no shared Select component exists). */
const selectClass =
  'h-9 w-40 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

// SPOC data-entry "action needed" emphasis — scoped to this screen only, replacing
// the app-wide amber attention accent. The table sits on a soft #D0E9FF tint with a
// brand-blue left accent; the hovered row deepens to #dae9f8. The banner keeps its
// own #dae9f8 tint.
const ENTRY_TINT = 'bg-[#dae9f8]';
const ENTRY_ACCENT = 'border-l-4 border-l-[#4579B3] bg-[#D0E9FF]';
const ROW_HOVER = 'hover:bg-[#dae9f8]';

/** True when a draft line holds any data — drives the remove-confirm dialog. */
function lineHasData(l: LineDraft): boolean {
  return (
    l.particulars.some(particularHasData) ||
    l.vendor.trim() !== '' ||
    l.product.trim() !== '' ||
    l.note.trim() !== ''
  );
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

  // Per-head editable vendor lines (snapshotId → LineDraft[]).
  const [lines, setLines] = useState<LinesState>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Recall confirmation dialog (with an optional reason for the timeline).
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallReason, setRecallReason] = useState('');
  // Remove-line confirmation (only for a line that already holds data).
  const [removeTarget, setRemoveTarget] = useState<{ snapshotId: string; index: number } | null>(
    null,
  );

  // Seed inputs whenever the detail (re)loads.
  useEffect(() => {
    if (detail) setLines(seedLines(detail));
  }, [detail]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  const patchLine = (snapshotId: string, index: number, patch: Partial<LineDraft>) => {
    setLines((prev) => {
      const next = (prev[snapshotId] ?? []).map((l, i) => (i === index ? { ...l, ...patch } : l));
      return { ...prev, [snapshotId]: next };
    });
  };
  const addLine = (snapshotId: string) => {
    setLines((prev) => ({ ...prev, [snapshotId]: [...(prev[snapshotId] ?? []), blankLine()] }));
  };
  const removeLine = (snapshotId: string, index: number) => {
    setLines((prev) => ({
      ...prev,
      [snapshotId]: (prev[snapshotId] ?? []).filter((_, i) => i !== index),
    }));
  };
  // First/only line is never removable; a line with data asks for confirmation.
  const requestRemove = (snapshotId: string, index: number) => {
    if (index === 0) return;
    const line = lines[snapshotId]?.[index];
    if (line && lineHasData(line)) setRemoveTarget({ snapshotId, index });
    else removeLine(snapshotId, index);
  };

  // ── Particulars, nested one level under a vendor line ──────────────────────
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
  const addParticular = (snapshotId: string, lineIndex: number) => {
    setLines((prev) => ({
      ...prev,
      [snapshotId]: (prev[snapshotId] ?? []).map((l, i) =>
        i === lineIndex ? { ...l, particulars: [...l.particulars, blankParticular()] } : l,
      ),
    }));
  };
  // The last particular of a vendor line is never removable (min one) — the
  // sub-table hides the control there, and this guard makes it unreachable anyway.
  const removeParticular = (snapshotId: string, lineIndex: number, particularIndex: number) => {
    setLines((prev) => ({
      ...prev,
      [snapshotId]: (prev[snapshotId] ?? []).map((l, i) =>
        i === lineIndex && l.particulars.length > 1
          ? { ...l, particulars: l.particulars.filter((_, j) => j !== particularIndex) }
          : l,
      ),
    }));
  };

  const saveMutation = useMutation({
    mutationFn: () => saveEntries(submissionId, collectSpocEntries(detail!, lines)),
    onSuccess: (updated) => {
      setError(null);
      setLines(seedLines(updated));
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save. Please try again.')),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await saveEntries(submissionId, collectSpocEntries(detail!, lines));
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

  const missingCount = useMemo(
    () => (detail ? incompleteHeadCount(detail, lines) : 0),
    [detail, lines],
  );

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
            {pending && <ActionNeededBadge />}
            <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
          </div>
        </div>
      </div>

      {isSentBack && (
        <div className="rounded-lg border border-warning-foreground/25 bg-warning p-4 text-sm text-warning-foreground">
          This submission was sent back for revision. Review the comments below, update the values
          and resubmit.
        </div>
      )}

      {pending && !isSentBack && (
        <div
          role="status"
          className={cn(
            'flex items-center gap-2 rounded-lg border border-[#4579B3]/30 px-4 py-3 text-sm font-medium text-foreground',
            ENTRY_TINT,
          )}
        >
          <CircleAlert className="size-4 shrink-0 text-[#4579B3]" aria-hidden />
          <span>
            Action needed — enter this month&rsquo;s figures for every expense head and submit for
            review.
          </span>
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
                <AttachmentList attachments={c.attachments} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={cn('rounded-lg border', pending && ENTRY_ACCENT)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>G/L Account No.</TableHead>
              <TableHead>G/L Account Name</TableHead>
              <TableHead>Vendor Name</TableHead>
              <TableHead>Product Code *</TableHead>
              <TableHead className="text-right">Amount (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.heads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No expense heads are mapped to this clinic. Contact Finance.
                </TableCell>
              </TableRow>
            ) : (
              detail.heads.map((head) => {
                const headLines = lines[head.snapshotId] ?? [];
                const multi = head.allowsMultipleVendors;
                // The head's Amount (₹) — the roll-up of its vendor lines, each of
                // which is itself the roll-up of its particulars. Null (rendered
                // "—") while anything underneath is still incomplete.
                const headTotal = minorToAmountString(headAmountMinor(headLines));
                return (
                  <Fragment key={head.snapshotId}>
                    {headLines.map((line, li) => {
                      const lineAmount = minorToAmountString(lineAmountMinor(line));
                      const rowKey = line.entryId ?? `new-${li}`;
                      return (
                      <Fragment key={rowKey}>
                      <TableRow className={cn(ROW_HOVER, li === 0 ? HEAD_ROW : VENDOR_ROW)}>
                        <TableCell className={cn('align-top', li === 0 ? HEAD_TEXT : 'text-muted-foreground')}>
                          {li === 0 ? head.glAccountNo : ''}
                        </TableCell>
                        <TableCell className={cn('align-top', li === 0 ? HEAD_TEXT : 'font-medium')}>
                          {li === 0 ? (
                            <div>{head.glAccountName}</div>
                          ) : (
                            <div className="pl-4 text-muted-foreground">↳</div>
                          )}
                          {canEdit ? (
                            <Textarea
                              rows={2}
                              placeholder="Note for this line (optional) — e.g. why it changed this month."
                              className={cn('mt-1.5 text-sm font-normal', li > 0 && 'ml-4')}
                              value={line.note}
                              onChange={(e) =>
                                patchLine(head.snapshotId, li, { note: e.target.value })
                              }
                            />
                          ) : (
                            line.note && (
                              <p className="mt-1 whitespace-pre-wrap text-xs font-normal text-muted-foreground">
                                {line.note}
                              </p>
                            )
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {canEdit ? (
                            <Input
                              type="text"
                              placeholder="Vendor (optional)"
                              className="w-48"
                              value={line.vendor}
                              onChange={(e) =>
                                patchLine(head.snapshotId, li, { vendor: e.target.value })
                              }
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">{line.vendor}</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {canEdit ? (
                            <select
                              className={cn(
                                selectClass,
                                // Unfilled required field — flagged, not blocked.
                                !line.product && 'border-warning-foreground/40',
                              )}
                              value={line.product}
                              onChange={(e) =>
                                patchLine(head.snapshotId, li, { product: e.target.value })
                              }
                            >
                              {/* REQUIRED at submit, but still selectable while
                                  drafting — a partial save must remain possible.
                                  Blank is stored as null, never coerced. */}
                              <option value="">— select —</option>
                              {PRODUCT_CODES.map((code) => (
                                // Label is "Code - Description"; the VALUE stored
                                // and sent to the API is the bare code.
                                <option key={code} value={code}>
                                  {productCodeLabel(code)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {line.product ? productCodeLabel(line.product) : ''}
                            </span>
                          )}
                        </TableCell>
                        {/*
                          Derived vendor-line subtotal — the sum of this line's
                          particulars. Read-only in BOTH modes: the amount is no
                          longer typed anywhere, it is only ever rolled up.
                        */}
                        <TableCell className="align-top text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span
                              className={cn(
                                headLines.length === 1 ? HEAD_AMOUNT : LINE_AMOUNT,
                                lineAmount === null && 'font-normal text-muted-foreground',
                              )}
                            >
                              {formatINR(lineAmount)}
                            </span>
                            {canEdit && li > 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                aria-label="Remove this vendor line"
                                onClick={() => requestRemove(head.snapshotId, li)}
                              >
                                <X className="size-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {/*
                        This vendor line's particulars, indented one level so the
                        head → vendor line → particular nesting is obvious. Spans
                        the remaining width rather than sitting inside the Amount
                        column, so nothing else on the vendor row moves.
                      */}
                      <TableRow className={PARTICULARS_ROW}>
                        <TableCell />
                        <TableCell colSpan={4} className="py-2 pr-4">
                          <div className="pl-4">
                            <ParticularsTable
                              particulars={line.particulars}
                              editable={canEdit}
                              onPatch={(pi, patch) =>
                                patchParticular(head.snapshotId, li, pi, patch)
                              }
                              onAdd={() => addParticular(head.snapshotId, li)}
                              onRemove={(pi) => removeParticular(head.snapshotId, li, pi)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                      </Fragment>
                      );
                    })}
                    {canEdit && multi && (
                      <TableRow className={ADD_ROW}>
                        <TableCell />
                        <TableCell colSpan={4} className="py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground"
                            onClick={() => addLine(head.snapshotId)}
                          >
                            <Plus className="size-3.5" />
                            Add vendor row
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                    {/*
                      The head's Amount (₹) roll-up. Only shown once a head actually
                      has several vendor lines — for a single-line head the subtotal
                      above already IS the head amount, and repeating it is noise.
                    */}
                    {headLines.length > 1 && (
                      <TableRow className={TOTAL_ROW}>
                        <TableCell />
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
              })
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
              Every line needs a product code, and every particular a name, a rate and a
              quantity, before submitting ({missingCount} incomplete{' '}
              {missingCount === 1 ? 'head' : 'heads'}). Zero is a valid rate or quantity; remove
              any row you don&rsquo;t need.
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

      {/* Remove-line confirmation — only shown for a line that holds data. */}
      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this vendor line?</DialogTitle>
            <DialogDescription>
              The line&rsquo;s vendor, note and all of its particulars will be discarded when you
              next save. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) removeLine(removeTarget.snapshotId, removeTarget.index);
                setRemoveTarget(null);
              }}
            >
              Remove line
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

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
  collectFieldErrors,
  collectSpocEntries,
  headAmountMinor,
  incompleteHeadCount,
  lineAmountMinor,
  lineFieldId,
  minorToAmountString,
  particularFieldId,
  particularHasData,
  seedLines,
  type LineDraft,
  type LinesState,
  type ParticularDraft,
} from '@/lib/provisionLines';
import { FieldErrorText } from '@/components/FieldError';
import { INVALID_FIELD_CLASS, fieldErrorTextId } from '@/lib/fieldErrors';
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
import {
  HEAD_HIGHLIGHT_CELL,
  HEAD_HIGHLIGHT_ROW,
  HEAD_JUMP_BUTTON,
  headAnchorId,
  reportHeadAnchorId,
  useHeadHighlight,
} from '@/lib/headHighlight';

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
    l.particulars.some(particularHasData) || l.vendor.trim() !== '' || l.product.trim() !== ''
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
  // Flipped by a BLOCKED submit, never by typing: the form stays unmarked while it
  // is being filled in, then shows every gap at once. `focusNonce` re-fires the
  // scroll-to-first when submit is pressed again without anything having changed.
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
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

  // Seed inputs whenever the detail (re)loads. A reload replaces the whole form, so
  // any markers from a previous blocked submit no longer describe what's on screen.
  useEffect(() => {
    if (detail) {
      setLines(seedLines(detail));
      setShowFieldErrors(false);
    }
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

  // Recomputed from the CURRENT draft on every keystroke, so a field's marker
  // disappears the moment it becomes valid and the banner's count ticks down as the
  // SPOC works through the list — no per-field "touched" bookkeeping needed.
  const fieldErrors = useMemo(
    () => (detail ? collectFieldErrors(detail, lines) : []),
    [detail, lines],
  );
  const errorByKey = useMemo(
    () => new Map(fieldErrors.map((e) => [e.key, e.message])),
    [fieldErrors],
  );
  /** A field's message, but only once a submit has actually been blocked. */
  const errorFor = (key: string): string | undefined =>
    showFieldErrors ? errorByKey.get(key) : undefined;

  // Scroll to + focus the first offender. In an effect (not the click handler) so it
  // runs after the markers have been committed, and keyed on the nonce so pressing
  // Submit again with nothing fixed still takes the user back to the top of the list.
  useEffect(() => {
    if (!showFieldErrors || focusNonce === 0 || fieldErrors.length === 0) return;
    const el = document.getElementById(fieldErrors[0].key);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // `preventScroll` so focus doesn't fight the smooth scroll with a jump.
    (el as HTMLElement | null)?.focus?.({ preventScroll: true });
    // fieldErrors is intentionally NOT a dependency: it changes on every keystroke,
    // and re-running then would yank the cursor away mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, showFieldErrors]);

  /**
   * Submit gate. Nothing is sent while a required field is empty — the click marks
   * every gap instead. The server re-checks all of it regardless; this only saves
   * the round-trip and points at the offenders.
   */
  const attemptSubmit = () => {
    if (fieldErrors.length > 0) {
      setShowFieldErrors(true);
      setFocusNonce((n) => n + 1);
      return;
    }
    setShowFieldErrors(false);
    submitMutation.mutate();
  };

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
              <TableHead>Vendor Name *</TableHead>
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
                // Highlighted by a click on this head in the chart below.
                const lit = highlightedHeadId === head.expenseHeadId;
                return (
                  <Fragment key={head.snapshotId}>
                    {headLines.map((line, li) => {
                      const lineAmount = minorToAmountString(lineAmountMinor(line));
                      const rowKey = line.entryId ?? `new-${li}`;
                      // Ids are stable per (head, line, field) and double as the
                      // scroll targets for the first-invalid jump.
                      const vendorFieldId = lineFieldId(head.snapshotId, li, 'vendor');
                      const productFieldId = lineFieldId(head.snapshotId, li, 'product');
                      const vendorError = errorFor(vendorFieldId);
                      const productError = errorFor(productFieldId);
                      return (
                      <Fragment key={rowKey}>
                      <TableRow className={cn(ROW_HOVER, li === 0 ? HEAD_ROW : VENDOR_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                        <TableCell
                          // The scroll target for this head, keyed by expense-head id
                          // (the same id keying the chart palette). scroll-mt keeps
                          // the row clear of anything sticky above the table.
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
                        <TableCell className="align-top">
                          {canEdit ? (
                            <>
                              <Input
                                id={vendorFieldId}
                                type="text"
                                placeholder="Vendor"
                                // REQUIRED at submit, but still savable while blank —
                                // a partial draft must remain parkable. Unfilled reads
                                // as a soft amber hint while drafting and turns into a
                                // hard error only once submit has been blocked.
                                className={cn(
                                  'w-48 scroll-mt-28',
                                  !line.vendor && 'border-warning-foreground/40',
                                  vendorError && INVALID_FIELD_CLASS,
                                )}
                                aria-invalid={vendorError ? true : undefined}
                                aria-describedby={
                                  vendorError ? fieldErrorTextId(vendorFieldId) : undefined
                                }
                                value={line.vendor}
                                onChange={(e) =>
                                  patchLine(head.snapshotId, li, { vendor: e.target.value })
                                }
                              />
                              <FieldErrorText
                                id={fieldErrorTextId(vendorFieldId)}
                                message={vendorError}
                              />
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">{line.vendor}</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {canEdit ? (
                            <>
                            <select
                              id={productFieldId}
                              className={cn(
                                selectClass,
                                'scroll-mt-28',
                                // Unfilled required field — flagged, not blocked.
                                !line.product && 'border-warning-foreground/40',
                                productError && INVALID_FIELD_CLASS,
                              )}
                              aria-invalid={productError ? true : undefined}
                              aria-describedby={
                                productError ? fieldErrorTextId(productFieldId) : undefined
                              }
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
                            <FieldErrorText
                              id={fieldErrorTextId(productFieldId)}
                              message={productError}
                            />
                            </>
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
                        This vendor line's particulars. Starts flush under the G/L
                        Account Name column — the extra indent went with the
                        head-level note textarea that used to sit in that cell — and
                        runs to the right edge, which is the width the per-particular
                        Remark input now uses. Spanning the remaining columns rather
                        than sitting inside the Amount column keeps the vendor row
                        above it exactly where it was.
                      */}
                      <TableRow className={cn(PARTICULARS_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                        <TableCell className={cn(lit && HEAD_HIGHLIGHT_CELL)} />
                        <TableCell colSpan={4} className="py-2 pr-4">
                          <ParticularsTable
                            particulars={line.particulars}
                            editable={canEdit}
                            fieldMeta={(pi, kind) => {
                              const id = particularFieldId(head.snapshotId, li, pi, kind);
                              return { id, error: errorFor(id) };
                            }}
                            onPatch={(pi, patch) => patchParticular(head.snapshotId, li, pi, patch)}
                            onAdd={() => addParticular(head.snapshotId, li)}
                            onRemove={(pi) => removeParticular(head.snapshotId, li, pi)}
                          />
                        </TableCell>
                      </TableRow>
                      </Fragment>
                      );
                    })}
                    {canEdit && multi && (
                      <TableRow className={cn(ADD_ROW, lit && HEAD_HIGHLIGHT_ROW)}>
                        <TableCell className={cn(lit && HEAD_HIGHLIGHT_CELL)} />
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

      {/* Summary of a blocked submit. The count is live — it falls as fields are
          filled and the banner disappears on the last one. */}
      {canEdit && showFieldErrors && fieldErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-error px-4 py-3 text-sm text-error-foreground"
        >
          <p className="font-medium">
            {fieldErrors.length} field{fieldErrors.length === 1 ? '' : 's'} need
            {fieldErrors.length === 1 ? 's' : ''} attention before you can submit.
          </p>
          <p className="mt-0.5 text-xs">
            Each one is marked below. Zero is a valid rate or quantity; remove any row you
            don&rsquo;t need.
          </p>
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : 'Save draft'}
          </Button>
          {/* Deliberately NOT disabled on an incomplete form: pressing Submit is what
              reveals the gaps. It only blocks on a genuinely unusable form (no heads
              mapped at all) or while a request is in flight. */}
          <Button disabled={busy || detail.heads.length === 0} onClick={attemptSubmit}>
            {submitMutation.isPending ? 'Submitting…' : 'Submit for review'}
          </Button>
          {missingCount > 0 && !showFieldErrors && (
            <span className="text-xs text-muted-foreground">
              Every line needs a vendor name and a product code, and every particular a name,
              a rate and a quantity, before submitting ({missingCount} incomplete{' '}
              {missingCount === 1 ? 'head' : 'heads'}).
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
              The line&rsquo;s vendor and all of its particulars — including their remarks —
              will be discarded when you next save. This cannot be undone.
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

      <MonthwiseReportPanel
        clinicId={detail.clinicId}
        onHeadClick={highlightHead}
        highlightedHeadId={trendHeadId}
        highlightNonce={trendNonce}
      />
    </div>
  );
}

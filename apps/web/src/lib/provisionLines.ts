import {
  QUANTITY_DECIMALS,
  RATE_DECIMALS,
  computeValueMinor,
  minorToDecimalString,
  sumMinor,
  type ProvisionEntryInput,
  type ProvisionHeadRow,
  type ProvisionLineInput,
  type ProvisionParticularInput,
  type SubmissionDetail,
} from '@portal/shared';

/**
 * Editable draft of one particular (rate × quantity) in the provision form.
 * `particularId` is null for a row the user has added but not yet saved. Rate and
 * quantity are raw input strings — the derived value is NEVER stored here, it is
 * computed on render from the same shared maths the server uses on save, so the
 * live figure and the persisted one can't drift apart.
 */
export interface ParticularDraft {
  particularId: string | null;
  name: string;
  rate: string;
  quantity: string;
  /**
   * The SPOC's optional free-text explanation for THIS row (it used to hang off the
   * vendor line as `note`). Empty string here = "not entered" and is sent as
   * undefined → stored as null; a blank remark is never a placeholder value.
   */
  remark: string;
}

/**
 * Editable draft of one vendor line. `entryId` is null for a line the user has
 * added but not yet saved. There is no `amount` field: the line's amount is the
 * sum of its particulars' values and is only ever derived.
 */
export interface LineDraft {
  entryId: string | null;
  particulars: ParticularDraft[];
  vendor: string;
  product: string;
}

/** Per-head (snapshotId → its lines) editable state. */
export type LinesState = Record<string, LineDraft[]>;

/**
 * A trimmed, valid non-negative decimal with at most `maxDecimals` places, or null
 * if blank/invalid. Null means "not entered" — deliberately NOT 0, so a blank rate
 * stays incomplete instead of silently valuing the row at nothing.
 */
export function parseDecimalInput(raw: string, maxDecimals: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  // Reject more precision than the column stores rather than silently rounding
  // the user's input to something they didn't type.
  const decimals = trimmed.split('.')[1]?.length ?? 0;
  if (decimals > maxDecimals) return null;
  return n;
}

export const parseRate = (raw: string): number | null => parseDecimalInput(raw, RATE_DECIMALS);
export const parseQuantity = (raw: string): number | null =>
  parseDecimalInput(raw, QUANTITY_DECIMALS);

/** A particular's derived value in paise, or null while rate/quantity is blank. */
export function particularValueMinor(p: ParticularDraft): bigint | null {
  return computeValueMinor(parseRate(p.rate), parseQuantity(p.quantity));
}

/**
 * A vendor line's derived amount in paise: the sum of its particulars' values, or
 * null if ANY of them is still blank (sumMinor propagates incompleteness) — a
 * half-filled line shows "—" rather than a partial sum that looks like a total.
 */
export function lineAmountMinor(line: LineDraft): bigint | null {
  return sumMinor(line.particulars.map(particularValueMinor));
}

/** A head's derived Amount (₹) in paise: the roll-up of its vendor lines. */
export function headAmountMinor(lines: LineDraft[]): bigint | null {
  return sumMinor(lines.map(lineAmountMinor));
}

/** Paise → the DECIMAL(14,2) string the money formatter takes; null passes through. */
export function minorToAmountString(minor: bigint | null): string | null {
  return minor === null ? null : minorToDecimalString(minor);
}

/** True when a particular is fully entered — name AND rate AND quantity (0 is fine). */
export function isParticularComplete(p: ParticularDraft): boolean {
  return p.name.trim() !== '' && parseRate(p.rate) !== null && parseQuantity(p.quantity) !== null;
}

/**
 * True when a particular carries any user data at all (drives remove-confirm). A
 * remark counts: dropping a row the SPOC has written an explanation on is still a
 * loss of typed work, even if no figures were entered.
 */
export function particularHasData(p: ParticularDraft): boolean {
  return (
    p.name.trim() !== '' ||
    p.rate.trim() !== '' ||
    p.quantity.trim() !== '' ||
    p.remark.trim() !== ''
  );
}

/** True when a line carries any user data (particulars, vendor or product). */
function hasData(line: LineDraft): boolean {
  return (
    line.particulars.some(particularHasData) ||
    line.vendor.trim() !== '' ||
    line.product.trim() !== ''
  );
}

/** A fresh, empty particular the user just added (never saved yet). */
export function blankParticular(): ParticularDraft {
  return { particularId: null, name: '', rate: '', quantity: '', remark: '' };
}

/** A fresh, empty vendor line — always born with its one required particular. */
export function blankLine(): LineDraft {
  return { entryId: null, particulars: [blankParticular()], vendor: '', product: '' };
}

/** Build the editable line state from a freshly-loaded detail (>=1 line per head). */
export function seedLines(detail: SubmissionDetail): LinesState {
  const state: LinesState = {};
  for (const head of detail.heads) {
    state[head.snapshotId] = head.lines.map((l) => ({
      entryId: l.entryId,
      // The server guarantees at least one particular per line; fall back to a
      // blank one so the sub-table always has a row to render into.
      particulars:
        l.particulars.length > 0
          ? l.particulars.map((p) => ({
              particularId: p.particularId,
              name: p.particularName ?? '',
              rate: p.rate ?? '',
              quantity: p.quantity ?? '',
              remark: p.remark ?? '',
            }))
          : [blankParticular()],
      vendor: l.vendorName ?? '',
      product: l.productCode ?? '',
    }));
  }
  return state;
}

function toParticularInput(p: ParticularDraft): ProvisionParticularInput {
  return {
    particularId: p.particularId ?? undefined,
    particularName: p.name.trim() || undefined,
    rate: parseRate(p.rate),
    quantity: parseQuantity(p.quantity),
    remark: p.remark.trim() || undefined,
  };
}

function toLineInput(line: LineDraft): ProvisionLineInput {
  return {
    entryId: line.entryId ?? undefined,
    particulars: line.particulars.map(toParticularInput),
    vendorName: line.vendor.trim() || undefined,
    productCode: line.product.trim() || undefined,
  };
}

/**
 * SPOC save payload. Reconciliation is per-HEAD: a head is sent (with its FULL
 * line set, each line with its FULL particular set) only when it's "active", so an
 * untouched head is left exactly as it is today.
 *  - Single-vendor head: sent only when its one line carries data — the same rule
 *    as before (blank ⇒ omit; a cleared value is never forced to null).
 *  - Multi-vendor head: sent when it has more than one line OR any line carries
 *    data — so added lines persist (blank ones as null, which submit then blocks)
 *    and removed lines drop out for the server to delete.
 *
 * No total of any kind is sent: the payload carries only rate/quantity, and the
 * server derives every value and sum from them.
 */
export function collectSpocEntries(detail: SubmissionDetail, state: LinesState): ProvisionEntryInput[] {
  const out: ProvisionEntryInput[] = [];
  for (const head of detail.heads) {
    const lines = state[head.snapshotId] ?? [];
    if (lines.length === 0) continue;
    if (head.allowsMultipleVendors) {
      const active = lines.length > 1 || lines.some((l) => l.entryId || hasData(l));
      if (active) out.push({ snapshotId: head.snapshotId, lines: lines.map(toLineInput) });
    } else {
      const line = lines[0];
      if (line && (line.entryId || hasData(line))) {
        out.push({ snapshotId: head.snapshotId, lines: [toLineInput(line)] });
      }
    }
  }
  return out;
}

/**
 * Manager/finance override payload: edit the PARTICULARS of EXISTING lines only
 * (never add or remove lines/particulars, never touch the line's vendor/product or a
 * particular's remark). Values and totals re-derive server-side from the
 * rate/quantity sent here, so an override can't assert an amount that contradicts
 * its particulars.
 */
export function collectOverrideEntries(
  detail: SubmissionDetail,
  state: LinesState,
): ProvisionEntryInput[] {
  const out: ProvisionEntryInput[] = [];
  for (const head of detail.heads) {
    const lines = (state[head.snapshotId] ?? []).filter((l) => l.entryId);
    const payload = lines
      .map((l) => ({
        entryId: l.entryId!,
        particulars: l.particulars
          .filter((p) => p.particularId)
          .map((p) => ({
            particularId: p.particularId!,
            particularName: p.name.trim() || undefined,
            rate: parseRate(p.rate),
            quantity: parseQuantity(p.quantity),
            // `remark` is deliberately OMITTED: it is SPOC-owned, the server keeps
            // the stored value on this path, and sending it would only add noise to
            // the audit diff.
          })),
      }))
      .filter((l) => l.particulars.length > 0);
    if (payload.length > 0) out.push({ snapshotId: head.snapshotId, lines: payload });
  }
  return out;
}

/**
 * True when a vendor line is fully entered: a vendor name, a product code AND
 * complete particulars.
 */
export function isLineComplete(line: LineDraft): boolean {
  return (
    // Vendor name and product code are BOTH required per vendor line; only the
    // per-particular remark stays optional.
    line.vendor.trim() !== '' &&
    line.product.trim() !== '' &&
    line.particulars.length > 0 &&
    line.particulars.every(isParticularComplete)
  );
}

/**
 * Heads that block submit: a head is incomplete when it has no lines, or when any
 * of its lines is missing a vendor name or a product code, has no particulars, or
 * holds a particular missing a name, a rate or a quantity (0 is valid; blank is
 * not). Amounts are
 * derived so they're never independently "missing" — a head is incomplete exactly
 * when one of its lines is. Mirrors the server's submit rule so the button
 * disables before the request rather than after a 422.
 */
export function incompleteHeadCount(detail: SubmissionDetail, state: LinesState): number {
  return detail.heads.filter((head: ProvisionHeadRow) => {
    const lines = state[head.snapshotId] ?? [];
    if (lines.length === 0) return true;
    return !lines.every(isLineComplete);
  }).length;
}

// ── Per-field submit validation (the inline "fix these" markers) ──────────────

/** Which required input a validation error belongs to. */
export type FieldErrorKind = 'vendor' | 'product' | 'name' | 'rate' | 'quantity';

/**
 * ONE required field that is not filled in. `key` doubles as the input's DOM id,
 * so the same value drives the inline marker, the error message and the
 * scroll-to-first-invalid on a blocked submit.
 */
export interface FieldError {
  key: string;
  snapshotId: string;
  lineIndex: number;
  /** Null for the line-level fields (vendor, product code). */
  particularIndex: number | null;
  kind: FieldErrorKind;
  /** Short, imperative, shown under the field. */
  message: string;
}

/** DOM id / error key for a LINE-level required field. */
export function lineFieldId(snapshotId: string, lineIndex: number, kind: FieldErrorKind): string {
  return `f-${snapshotId}-l${lineIndex}-${kind}`;
}

/** DOM id / error key for a PARTICULAR-level required field. */
export function particularFieldId(
  snapshotId: string,
  lineIndex: number,
  particularIndex: number,
  kind: FieldErrorKind,
): string {
  return `f-${snapshotId}-l${lineIndex}-p${particularIndex}-${kind}`;
}

/**
 * Every unfilled required field in the whole form, in DOM order.
 *
 * This is `incompleteHeadCount`'s rule at FIELD granularity — the same conditions,
 * reported one-per-input instead of one-per-head, so submit can mark each offender
 * inline rather than showing a single sentence about "3 incomplete heads". Both
 * mirror the server's `assertAllHeadsValued`, which remains the real gate; this is
 * purely how the gap is shown.
 *
 * Deliberately collects EVERYTHING rather than short-circuiting on the first
 * failure — the point is to let the SPOC see and fix the whole list in one pass.
 *
 * Order is the reading order of the form (head → vendor line → vendor, product,
 * then each particular's name, rate, quantity), so `[0]` really is the topmost
 * offending field on screen.
 *
 * NULL ≠ 0 throughout: a rate or quantity of 0 is complete and valid, a blank one
 * is missing. Nothing here defaults a blank to 0.
 */
export function collectFieldErrors(detail: SubmissionDetail, state: LinesState): FieldError[] {
  const errors: FieldError[] = [];
  for (const head of detail.heads as ProvisionHeadRow[]) {
    const lines = state[head.snapshotId] ?? [];
    lines.forEach((line, li) => {
      const at = (kind: FieldErrorKind, message: string) =>
        errors.push({
          key: lineFieldId(head.snapshotId, li, kind),
          snapshotId: head.snapshotId,
          lineIndex: li,
          particularIndex: null,
          kind,
          message,
        });
      if (line.vendor.trim() === '') at('vendor', 'Enter a vendor name');
      if (line.product.trim() === '') at('product', 'Select a product code');

      line.particulars.forEach((p, pi) => {
        const atP = (kind: FieldErrorKind, message: string) =>
          errors.push({
            key: particularFieldId(head.snapshotId, li, pi, kind),
            snapshotId: head.snapshotId,
            lineIndex: li,
            particularIndex: pi,
            kind,
            message,
          });
        if (p.name.trim() === '') atP('name', 'Enter a name');
        // parseRate/parseQuantity return null for blank AND for unparseable text;
        // 0 parses to 0, which is valid and therefore never flagged.
        if (parseRate(p.rate) === null) atP('rate', 'Enter a rate');
        if (parseQuantity(p.quantity) === null) atP('quantity', 'Enter a quantity');
      });
    });
  }
  return errors;
}

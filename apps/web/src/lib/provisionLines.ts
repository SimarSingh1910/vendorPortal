import type {
  ProvisionEntryInput,
  ProvisionHeadRow,
  ProvisionLineInput,
  SubmissionDetail,
} from '@portal/shared';

/**
 * Editable draft of one vendor line in the provision form. `entryId` is null for
 * a line the SPOC has added but not yet saved; all values are raw input strings.
 */
export interface LineDraft {
  entryId: string | null;
  amount: string;
  vendor: string;
  product: string;
  note: string;
}

/** Per-head (snapshotId → its lines) editable state. */
export type LinesState = Record<string, LineDraft[]>;

/** A trimmed, valid non-negative number, or null if blank/invalid. */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** True when a line carries any user data (amount, vendor, product or note). */
function hasData(line: LineDraft): boolean {
  return (
    parseAmount(line.amount) !== null ||
    line.vendor.trim() !== '' ||
    line.product.trim() !== '' ||
    line.note.trim() !== ''
  );
}

/** Build the editable line state from a freshly-loaded detail (>=1 line per head). */
export function seedLines(detail: SubmissionDetail): LinesState {
  const state: LinesState = {};
  for (const head of detail.heads) {
    state[head.snapshotId] = head.lines.map((l) => ({
      entryId: l.entryId,
      amount: l.amount ?? '',
      vendor: l.vendorName ?? '',
      product: l.productCode ?? '',
      note: l.note ?? '',
    }));
  }
  return state;
}

/** A fresh, empty line the SPOC just added (never saved yet). */
export function blankLine(): LineDraft {
  return { entryId: null, amount: '', vendor: '', product: '', note: '' };
}

function toLineInput(line: LineDraft): ProvisionLineInput {
  return {
    entryId: line.entryId ?? undefined,
    amount: parseAmount(line.amount),
    note: line.note.trim() || undefined,
    vendorName: line.vendor.trim() || undefined,
    productCode: line.product.trim() || undefined,
  };
}

/**
 * SPOC save payload. Reconciliation is per-HEAD: a head is sent (with its FULL
 * line set) only when it's "active", so an untouched head is left exactly as it
 * is today.
 *  - Single-vendor head: sent only when its one line has a parsed amount — the
 *    same rule as before this feature (blank ⇒ omit; a cleared value is never
 *    forced to null). Behaviour is unchanged for non-flagged heads.
 *  - Multi-vendor head: sent when it has more than one line OR any line carries
 *    data — so added lines persist (blank ones as null, which submit then blocks)
 *    and removed lines drop out for the server to delete.
 */
export function collectSpocEntries(detail: SubmissionDetail, state: LinesState): ProvisionEntryInput[] {
  const out: ProvisionEntryInput[] = [];
  for (const head of detail.heads) {
    const lines = state[head.snapshotId] ?? [];
    if (head.allowsMultipleVendors) {
      const active = lines.length > 1 || lines.some((l) => l.entryId || hasData(l));
      if (active) out.push({ snapshotId: head.snapshotId, lines: lines.map(toLineInput) });
    } else {
      const line = lines[0];
      if (line && parseAmount(line.amount) !== null) {
        out.push({ snapshotId: head.snapshotId, lines: [toLineInput(line)] });
      }
    }
  }
  return out;
}

/**
 * Manager/finance override payload: edit the amount of EXISTING lines only (never
 * add, remove, or touch vendor/product/note). Only lines with an id and a parsed
 * amount are sent.
 */
export function collectOverrideEntries(
  detail: SubmissionDetail,
  state: LinesState,
): ProvisionEntryInput[] {
  const out: ProvisionEntryInput[] = [];
  for (const head of detail.heads) {
    const lines = (state[head.snapshotId] ?? []).filter(
      (l) => l.entryId && parseAmount(l.amount) !== null,
    );
    if (lines.length > 0) {
      out.push({
        snapshotId: head.snapshotId,
        lines: lines.map((l) => ({ entryId: l.entryId!, amount: parseAmount(l.amount) })),
      });
    }
  }
  return out;
}

/**
 * Heads that block submit: a head with any blank-amount line is incomplete (every
 * line must have an amount). A head always has >=1 rendered line, so a wholly
 * blank head is caught here too. Returns the count for the SPOC submit gate.
 */
export function incompleteHeadCount(detail: SubmissionDetail, state: LinesState): number {
  return detail.heads.filter((head: ProvisionHeadRow) => {
    const lines = state[head.snapshotId] ?? [];
    return lines.length === 0 || lines.some((l) => parseAmount(l.amount) === null);
  }).length;
}

import type { HeadTrendPoint } from '@portal/shared';

/**
 * One expense head's change across the selected range. `firstValue`/`lastValue`
 * are the head's totals in the FIRST and LAST month of the range, and both are
 * guaranteed present (heads missing either endpoint are omitted — see below).
 * `pctChange` is null when `firstValue` is a genuine 0 (a real ₹0 baseline has
 * no percentage — distinct from a missing month, which omits the head entirely).
 */
export interface HeadChange {
  id: string;
  name: string;
  firstValue: number;
  lastValue: number;
  absChange: number; // lastValue − firstValue (always defined)
  pctChange: number | null; // null = ₹0 baseline, no % defined
}

export interface HeadChangeResult {
  firstMonth: string;
  lastMonth: string;
  /** Heads with a value in BOTH the first and last month, i.e. a real change. */
  changes: HeadChange[];
  /** Heads dropped because they lack a value in the first or last month. */
  omitted: Array<{ id: string; name: string }>;
}

/**
 * Derive each head's first→last change over the range spanned by `data`
 * (client-side, from the per-head monthly series already loaded).
 *
 * NULL ≠ 0 is critical: a head with NO point in the first or last month has an
 * undefined change and is OMITTED — never computed off an implied 0 (which would
 * fabricate a −100% / +∞ move). A head with a genuine 0 is kept (its absolute
 * change is real); only its % is left null, since dividing by 0 has no meaning.
 * No `?? 0` / `|| 0` anywhere — a missing month is `undefined`, a real 0 is `0`.
 */
export function deriveHeadChanges(data: HeadTrendPoint[]): HeadChangeResult {
  const months = [...new Set(data.map((d) => d.month))].sort();
  const firstMonth = months[0] ?? '';
  const lastMonth = months[months.length - 1] ?? '';

  // head id → { name, month → value }. Only points that exist are recorded, so a
  // missing month is genuinely absent (get() returns undefined), not 0.
  const byHead = new Map<string, { name: string; vals: Map<string, number> }>();
  for (const d of data) {
    let h = byHead.get(d.expenseHeadId);
    if (!h) {
      h = { name: d.expenseHeadName, vals: new Map() };
      byHead.set(d.expenseHeadId, h);
    }
    h.vals.set(d.month, Number(d.total));
  }

  const changes: HeadChange[] = [];
  const omitted: Array<{ id: string; name: string }> = [];
  for (const [id, h] of byHead) {
    const firstValue = h.vals.get(firstMonth);
    const lastValue = h.vals.get(lastMonth);
    // Missing an endpoint → change is undefined; omit rather than invent one.
    if (firstValue === undefined || lastValue === undefined) {
      omitted.push({ id, name: h.name });
      continue;
    }
    const absChange = lastValue - firstValue;
    const pctChange = firstValue !== 0 ? (absChange / firstValue) * 100 : null;
    changes.push({ id, name: h.name, firstValue, lastValue, absChange, pctChange });
  }
  return { firstMonth, lastMonth, changes, omitted };
}

/** Signed percent for value labels: `+18%` / `−32%` (U+2212 minus, 0 dp). */
export function formatSignedPct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)}%`;
}

/** Signed en-IN INR for value labels: `+₹6,240` / `−₹1,40,900` (no paise). */
export function formatSignedINR(n: number): string {
  return `${n >= 0 ? '+' : '−'}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

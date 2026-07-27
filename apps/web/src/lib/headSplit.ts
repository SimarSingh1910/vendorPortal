/** One expense head's summed provision over the range, for the split donut/table. */
export interface HeadSlice {
  id: string;
  name: string;
  total: number;
}

/**
 * Sum each expense head's provision across the range from the SAME per-head
 * points that drive the head-trend charts. A head with no points never enters
 * the map, so it can't become a slice, and a missing month is never summed as 0
 * (NULL ≠ 0 — no `?? 0` / `|| 0`). Only heads with a positive total are kept
 * (a zero net can't render a visible slice), then ranked largest → smallest so
 * the donut and its table share one order.
 */
export function headSplitTotals(
  data: ReadonlyArray<{ expenseHeadId: string; expenseHeadName: string; total: string }>,
): HeadSlice[] {
  const byId = new Map<string, HeadSlice>();
  for (const d of data) {
    const add = Number(d.total);
    if (!Number.isFinite(add)) continue;
    const cur = byId.get(d.expenseHeadId);
    if (cur) cur.total += add;
    else byId.set(d.expenseHeadId, { id: d.expenseHeadId, name: d.expenseHeadName, total: add });
  }
  return [...byId.values()].filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
}

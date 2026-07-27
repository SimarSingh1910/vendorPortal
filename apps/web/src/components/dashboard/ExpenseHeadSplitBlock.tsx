import { useMemo, useState, type ReactNode } from 'react';
import type { HeadTrendPoint, HeadVendorTrendPoint } from '@portal/shared';
import { ChartTableView } from './ChartTableView';
import { HeadMultiSelect } from './HeadMultiSelect';
import { ExpenseHeadPieChart } from './charts';
import { ExpenseHeadSplitTable, ExpenseHeadVendorSplitTable } from './dataTables';

/**
 * Expense-head split block: the same multi-select head filter + chart/table
 * toggle as the head-trend block, over a donut of each head's share of the range
 * total. "All heads" (the empty set) shows every head; picking a subset filters
 * BOTH the donut and the table to just those slices — client-side, no refetch.
 * With one head selected it is a single 100% slice. `colorOf` comes from the
 * dashboard's master head→colour map (built over ALL heads), so a head keeps its
 * app-wide colour whether 8 or 2 are shown — subsetting never reshuffles colours.
 */
export function ExpenseHeadSplitBlock({
  data,
  colorOf,
  monthControl,
  vendorData,
}: {
  data: HeadTrendPoint[];
  colorOf: (id: string) => string;
  /** Optional shared month picker, rendered before the head multi-select. */
  monthControl?: ReactNode;
  /**
   * Optional per-vendor breakdown. When supplied (clinic dashboards only), the
   * Table view breaks each head into its vendor lines; the donut stays head-level.
   * Omitted on corporate dashboards, which keep the head-level table.
   */
  vendorData?: HeadVendorTrendPoint[];
}) {
  // Head selection: `null` = All heads (default); empty Set = none; else a subset.
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // In-scope heads present in the data, name-sorted, for the checkbox list.
  const heads = useMemo(() => {
    const byId = new Map<string, string>();
    for (const d of data) byId.set(d.expenseHeadId, d.expenseHeadName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Drop any selected id that has left the dataset (e.g. a range change) so the
  // selection can't get stuck on a head that's no longer present. `null` ("all")
  // is preserved as-is.
  const valid = useMemo(
    () => (selected === null ? null : new Set([...selected].filter((id) => heads.some((h) => h.id === id)))),
    [selected, heads],
  );

  // "All" (null) shows every slice; otherwise only the chosen subset become slices.
  const filtered = valid === null ? data : data.filter((d) => valid.has(d.expenseHeadId));
  const noneSelected = valid !== null && valid.size === 0;
  // The vendor breakdown honours the same head selection as the donut/table.
  const filteredVendor = useMemo(
    () =>
      !vendorData
        ? undefined
        : valid === null
          ? vendorData
          : vendorData.filter((d) => valid.has(d.expenseHeadId)),
    [vendorData, valid],
  );

  const control = (
    <>
      {monthControl}
      <HeadMultiSelect heads={heads} selected={valid} onChange={setSelected} />
    </>
  );

  const empty = (
    <p className="py-12 text-center text-sm text-muted-foreground">
      No expense heads selected — tick one or “All heads”.
    </p>
  );

  const table = noneSelected ? (
    empty
  ) : filteredVendor ? (
    <ExpenseHeadVendorSplitTable data={filteredVendor} />
  ) : (
    <ExpenseHeadSplitTable data={filtered} />
  );

  return (
    <ChartTableView
      controls={control}
      chart={noneSelected ? empty : <ExpenseHeadPieChart data={filtered} colorOf={colorOf} />}
      table={table}
    />
  );
}

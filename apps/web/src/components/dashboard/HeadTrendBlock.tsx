import { useMemo, useState } from 'react';
import type { HeadTrendPoint } from '@portal/shared';
import { ChartTableView } from './ChartTableView';
import { HeadMultiSelect } from './HeadMultiSelect';
import { HeadTrendCharts } from './charts';
import { HeadTrendTable } from './dataTables';

/**
 * Expense-head-wise trend block: a multi-select head filter next to the
 * chart/table toggle. "All heads" (default, the empty set) keeps the full view;
 * picking any subset filters BOTH the chart and the table to just those heads —
 * client-side, no refetch. `colorOf` comes from the dashboard's master head→
 * colour map (built over ALL heads), so a head keeps its app-wide colour whether
 * 8 or 2 are shown — subsetting never reshuffles colours.
 */
export function HeadTrendBlock({
  data,
  colorOf,
}: {
  data: HeadTrendPoint[];
  colorOf: (id: string) => string;
}) {
  // Selected head ids; an EMPTY set means "All heads".
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // In-scope heads present in the data, name-sorted, for the checkbox list.
  const heads = useMemo(() => {
    const byId = new Map<string, string>();
    for (const d of data) byId.set(d.expenseHeadId, d.expenseHeadName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Drop any selected id that has left the dataset (e.g. a range change) so the
  // selection can't get stuck on a head that's no longer present.
  const valid = useMemo(
    () => new Set([...selected].filter((id) => heads.some((h) => h.id === id))),
    [selected, heads],
  );

  // Empty selection = all heads; otherwise render only the chosen subset. A head
  // with no value in a month is still a gap in the charts — never coerced to 0.
  const filtered = valid.size === 0 ? data : data.filter((d) => valid.has(d.expenseHeadId));

  const control = <HeadMultiSelect heads={heads} selected={valid} onChange={setSelected} />;

  return (
    <ChartTableView
      controls={control}
      chart={<HeadTrendCharts data={filtered} colorOf={colorOf} />}
      table={<HeadTrendTable data={filtered} />}
    />
  );
}

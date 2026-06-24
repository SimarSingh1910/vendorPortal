import { useMemo, useState } from 'react';
import type { HeadTrendPoint } from '@portal/shared';
import { ChartTableView } from './ChartTableView';
import { HeadTrendCharts } from './charts';
import { HeadTrendTable } from './dataTables';

/**
 * Expense-head-wise trend block: a single-head dropdown next to the chart/table
 * toggle. "All heads" (default) keeps the full view; selecting a head filters
 * BOTH the chart and the table to just that head's monthly trend — client-side,
 * no refetch. `colorOf` comes from the dashboard's master head→colour map, so a
 * filtered head keeps its app-wide colour.
 */
export function HeadTrendBlock({
  data,
  colorOf,
}: {
  data: HeadTrendPoint[];
  colorOf: (id: string) => string;
}) {
  const [headId, setHeadId] = useState('');

  // In-scope heads present in the data, name-sorted, for the dropdown.
  const heads = useMemo(() => {
    const byId = new Map<string, string>();
    for (const d of data) byId.set(d.expenseHeadId, d.expenseHeadName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // If the selected head leaves the dataset (e.g. range change), fall back to All.
  const activeId = headId && heads.some((h) => h.id === headId) ? headId : '';
  const filtered = activeId ? data.filter((d) => d.expenseHeadId === activeId) : data;

  const dropdown = (
    <select
      aria-label="Filter by expense head"
      value={activeId}
      onChange={(e) => setHeadId(e.target.value)}
      className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">All heads</option>
      {heads.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );

  return (
    <ChartTableView
      controls={dropdown}
      chart={<HeadTrendCharts data={filtered} colorOf={colorOf} />}
      table={<HeadTrendTable data={filtered} />}
    />
  );
}

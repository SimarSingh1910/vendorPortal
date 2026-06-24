import { useState, type ReactNode } from 'react';
import { BarChart3, TableProperties } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ChartTableViewMode = 'chart' | 'table';

/**
 * Reusable chart ⟷ table toggle (Step 5). A segmented two-button control so any
 * visualization can also be read as an accessible data table of the SAME data.
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: ChartTableViewMode;
  onChange: (v: ChartTableViewMode) => void;
}) {
  return (
    <div className="inline-flex" role="group" aria-label="Chart or table view">
      <Button
        type="button"
        size="sm"
        variant={view === 'chart' ? 'default' : 'outline'}
        className="rounded-r-none"
        aria-pressed={view === 'chart'}
        onClick={() => onChange('chart')}
      >
        <BarChart3 className="size-4" />
        Chart
      </Button>
      <Button
        type="button"
        size="sm"
        variant={view === 'table' ? 'default' : 'outline'}
        className="-ml-px rounded-l-none"
        aria-pressed={view === 'table'}
        onClick={() => onChange('table')}
      >
        <TableProperties className="size-4" />
        Table
      </Button>
    </div>
  );
}

/**
 * Wraps a visualization with the toggle. Both `chart` and `table` render the
 * already-fetched data passed by the parent, so flipping the view only swaps the
 * rendered subtree — it never refetches. Toggle state is local (per instance).
 */
export function ChartTableView({
  defaultView = 'chart',
  controls,
  chart,
  table,
}: {
  defaultView?: ChartTableViewMode;
  /** Optional extra controls (e.g. a filter dropdown) shown to the left of the toggle. */
  controls?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [view, setView] = useState<ChartTableViewMode>(defaultView);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {controls}
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === 'chart' ? chart : table}
    </div>
  );
}

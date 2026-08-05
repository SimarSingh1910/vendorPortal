import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_MONTHWISE_PRESET,
  MONTHWISE_PRESETS,
  type MonthwisePreset,
  type MonthwiseReport,
} from '@portal/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getClinicMonthwiseReport } from '@/api/dashboard';
import {
  ChartTableView,
  type ChartTableViewMode,
} from '@/components/dashboard/ChartTableView';
import { MonthwiseChart } from '@/components/dashboard/charts';
import { formatINR, formatMonth } from '@/lib/format';
import {
  HEAD_HIGHLIGHT_CELL,
  HEAD_HIGHLIGHT_ROW,
  reportHeadAnchorId,
} from '@/lib/headHighlight';
import { cn } from '@/lib/utils';

/**
 * Reusable month-wise report for a single clinic — the current cycle month
 * alongside a selectable number of preceding months. Embedded on the SPOC entry,
 * clinic-manager review and finance review screens (same component, clinic in
 * context). Table-first; Step 5 will add a chart/table view toggle here.
 *
 * Both directions of the head jump run through here (see lib/headHighlight):
 *
 *   • `onHeadClick` makes the CHART's G/L heads clickable — the host screen passes
 *     the trigger from `useHeadHighlight()` and the click scrolls to that head's
 *     block in the provision table ABOVE. Screens with no such table omit it and the
 *     legend stays static.
 *   • `highlightedHeadId` / `highlightNonce` come from the host's second instance,
 *     driven by clicking a G/L number/name in the provision table above: the row for
 *     that head in the TREND TABLE below is anchored and lit, so a figure can be
 *     checked against its own history in one click.
 *
 * Read-only in both directions — nothing is selected, filtered or written.
 */
export function MonthwiseReportPanel({
  clinicId,
  onHeadClick,
  highlightedHeadId = null,
  highlightNonce = 0,
}: {
  clinicId: string;
  onHeadClick?: (expenseHeadId: string) => void;
  /** The head to anchor + light up in the trend table (null = none). */
  highlightedHeadId?: string | null;
  /** Bumped on every jump, so re-picking the SAME head still forces the table view. */
  highlightNonce?: number;
}) {
  const [months, setMonths] = useState<MonthwisePreset>(DEFAULT_MONTHWISE_PRESET);
  const [view, setView] = useState<ChartTableViewMode>('table');

  // A jump targets a ROW, which only exists in the table half — so switch to it.
  // Done during render (not in an effect) so the row is already in the DOM by the
  // time the host's scroll effect runs; an effect here would commit the chart
  // first and the scroll would find nothing. Keyed on the NONCE so re-picking the
  // same head after manually flipping back to the chart still works.
  const [seenNonce, setSeenNonce] = useState(0);
  if (highlightedHeadId && highlightNonce !== seenNonce) {
    setSeenNonce(highlightNonce);
    setView('table');
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report', 'clinic-monthwise', clinicId, months],
    queryFn: () => getClinicMonthwiseReport(clinicId, months),
    enabled: !!clinicId,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>Month-wise report</CardTitle>
          <p className="text-sm text-muted-foreground">
            Current month next to the preceding months for this clinic.
          </p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Month window">
          {MONTHWISE_PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={months === p ? 'default' : 'outline'}
              onClick={() => setMonths(p)}
            >
              Last {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Could not load the report.</p>
        ) : (
          <ChartTableView
            view={view}
            onViewChange={setView}
            chart={<MonthwiseChart report={data} onHeadClick={onHeadClick} />}
            table={<MonthwiseTable report={data} highlightedHeadId={highlightedHeadId} />}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The trend grid: one row per expense head, one column per month in the window.
 *
 * Each row carries the head's anchor id, so a click on that G/L in the provision
 * table above can scroll straight to it; `highlightedHeadId` lights the row that was
 * jumped to. `scroll-mt` keeps it clear of anything sticky above the table.
 */
function MonthwiseTable({
  report,
  highlightedHeadId = null,
}: {
  report: MonthwiseReport;
  highlightedHeadId?: string | null;
}) {
  const isCurrent = (m: string) => m === report.currentMonth;

  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No figures recorded in this window yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Expense head</TableHead>
            {report.months.map((m) => (
              <TableHead
                key={m}
                className={cn(
                  'text-right whitespace-nowrap',
                  isCurrent(m) && 'bg-muted/50 font-semibold text-foreground',
                )}
              >
                {formatMonth(m)}
                {isCurrent(m) && <span className="ml-1 text-xs font-normal">(current)</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => {
            const lit = highlightedHeadId === row.expenseHeadId;
            return (
            <TableRow key={row.expenseHeadId} className={cn(lit && HEAD_HIGHLIGHT_ROW)}>
              <TableCell
                // Scroll target for this head, keyed by expense-head id.
                id={reportHeadAnchorId(row.expenseHeadId)}
                className={cn('scroll-mt-24 font-medium', lit && HEAD_HIGHLIGHT_CELL)}
              >
                {row.expenseHeadName}
              </TableCell>
              {row.values.map((v, i) => (
                <TableCell
                  key={report.months[i]}
                  className={cn(
                    'text-right tabular-nums',
                    isCurrent(report.months[i]) && 'bg-muted/30 font-medium',
                  )}
                >
                  {v === null ? <span className="text-muted-foreground">—</span> : formatINR(v)}
                </TableCell>
              ))}
            </TableRow>
            );
          })}
          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Total</TableCell>
            {report.totals.map((t, i) => (
              <TableCell
                key={report.months[i]}
                className={cn(
                  'text-right font-semibold tabular-nums',
                  isCurrent(report.months[i]) && 'bg-muted/40',
                )}
              >
                {t === null ? <span className="text-muted-foreground">—</span> : formatINR(t)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

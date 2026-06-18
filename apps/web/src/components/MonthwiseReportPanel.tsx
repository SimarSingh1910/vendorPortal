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
import { ChartTableView } from '@/components/dashboard/ChartTableView';
import { MonthwiseChart } from '@/components/dashboard/charts';
import { formatINR, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Reusable month-wise report for a single clinic — the current cycle month
 * alongside a selectable number of preceding months. Embedded on the SPOC entry,
 * clinic-manager review and finance review screens (same component, clinic in
 * context). Table-first; Step 5 will add a chart/table view toggle here.
 */
export function MonthwiseReportPanel({ clinicId }: { clinicId: string }) {
  const [months, setMonths] = useState<MonthwisePreset>(DEFAULT_MONTHWISE_PRESET);

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
            defaultView="table"
            chart={<MonthwiseChart report={data} />}
            table={<MonthwiseTable report={data} />}
          />
        )}
      </CardContent>
    </Card>
  );
}

function MonthwiseTable({ report }: { report: MonthwiseReport }) {
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
          {report.rows.map((row) => (
            <TableRow key={row.expenseHeadId}>
              <TableCell className="font-medium">{row.expenseHeadName}</TableCell>
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
          ))}
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

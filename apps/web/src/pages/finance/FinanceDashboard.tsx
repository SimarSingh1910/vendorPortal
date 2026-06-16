import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { SubmissionStatus, SUBMISSION_STATUS_LABELS } from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  exportClinicMonth,
  exportConsolidated,
  exportDashboardPdf,
  exportMonthEnd,
} from '@/api/export';
import {
  getClinicTotals,
  getDashboardFilters,
  getHeadTrends,
  getMonthlyTotals,
  getStatusTracker,
  getVariance,
  type DashboardFilter,
} from '@/api/dashboard';
import { StatusTiles } from '@/components/dashboard/StatusTiles';
import {
  ClinicTotalsChart,
  HeadTrendCharts,
  MonthlyTotalsChart,
} from '@/components/dashboard/charts';
import { formatINR, formatMonth } from '@/lib/format';

/** Current cost-provision month (YYYY-MM) in IST. */
function currentMonth(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shift a YYYY-MM month by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A native, Input-styled select for the filter row. */
function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

const STATUS_OPTIONS = Object.values(SubmissionStatus);

export function FinanceDashboard() {
  const thisMonth = currentMonth();
  const [clinicId, setClinicId] = useState('');
  const [expenseHeadId, setExpenseHeadId] = useState('');
  const [status, setStatus] = useState('');
  const [fromMonth, setFromMonth] = useState(shiftMonth(thisMonth, -11));
  const [toMonth, setToMonth] = useState(thisMonth);
  const [exporting, setExporting] = useState<string | null>(null);

  async function runExport(key: string, fn: () => Promise<void>) {
    setExporting(key);
    try {
      await fn();
    } finally {
      setExporting(null);
    }
  }

  // `toMonth` is the as-of month for the status tracker + variance; the pair
  // (from, to) bounds the trend charts.
  const asOf = toMonth || thisMonth;
  const rangeFilter: DashboardFilter = {
    clinicId: clinicId || undefined,
    expenseHeadId: expenseHeadId || undefined,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: status ? [status as SubmissionStatus] : undefined,
  };

  const { data: options } = useQuery({
    queryKey: ['dashboard', 'filters'],
    queryFn: getDashboardFilters,
  });
  const { data: tiles = [], isLoading: tilesLoading } = useQuery({
    queryKey: ['dashboard', 'status', asOf],
    queryFn: () => getStatusTracker(asOf),
  });
  const { data: variance } = useQuery({
    queryKey: ['dashboard', 'variance', asOf, clinicId],
    queryFn: () => getVariance(asOf, clinicId || undefined),
  });
  const { data: monthly = [] } = useQuery({
    queryKey: ['dashboard', 'monthly', rangeFilter],
    queryFn: () => getMonthlyTotals(rangeFilter),
    placeholderData: keepPreviousData,
  });
  const { data: headTrends = [] } = useQuery({
    queryKey: ['dashboard', 'head-trends', rangeFilter],
    queryFn: () => getHeadTrends(rangeFilter),
    placeholderData: keepPreviousData,
  });
  const { data: clinicTotals = [] } = useQuery({
    queryKey: ['dashboard', 'clinic-totals', rangeFilter],
    queryFn: () => getClinicTotals(rangeFilter),
    placeholderData: keepPreviousData,
  });

  const alerts = variance?.rows.filter((r) => r.flagged) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Finance Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Submission tracking, expense trends and variance alerts across all clinics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!exporting}
            onClick={() => runExport('consolidated', () => exportConsolidated(rangeFilter))}
          >
            <Download />
            {exporting === 'consolidated' ? 'Exporting…' : 'Excel'}
          </Button>
          {clinicId && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!exporting}
              onClick={() => runExport('clinic', () => exportClinicMonth(clinicId, asOf))}
            >
              <Download />
              {exporting === 'clinic' ? 'Exporting…' : 'Clinic month'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!!exporting}
            onClick={() => runExport('month-end', () => exportMonthEnd())}
          >
            <Download />
            {exporting === 'month-end' ? 'Exporting…' : 'Month-end report'}
          </Button>
          <Button
            size="sm"
            disabled={!!exporting}
            onClick={() => runExport('pdf', () => exportDashboardPdf(rangeFilter))}
          >
            <FileText />
            {exporting === 'pdf' ? 'Generating…' : 'PDF'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label>Clinic</Label>
          <Select value={clinicId} onChange={setClinicId}>
            <option value="">All clinics</option>
            {options?.clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Expense head</Label>
          <Select value={expenseHeadId} onChange={setExpenseHeadId}>
            <option value="">All heads</option>
            {options?.expenseHeads.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onChange={setStatus}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SUBMISSION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From month</Label>
          <Input id="from" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To month</Label>
          <Input id="to" type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
        </div>
      </div>

      {/* (a) Status tracker */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Submission status — {formatMonth(asOf)}
        </h2>
        {tilesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <StatusTiles tiles={tiles} />
        )}
      </section>

      {/* (e) Variance alerts */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Variance alerts — {formatMonth(asOf)} vs {variance ? formatMonth(variance.priorMonth) : '—'}
        </h2>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {variance?.thresholdPercent != null
                ? `Heads deviating beyond ±${variance.thresholdPercent}%`
                : 'No variance threshold configured'}
            </CardTitle>
            <CardDescription>
              {variance?.thresholdPercent == null
                ? `Set a variance threshold for ${formatMonth(asOf)} in Notification Config to enable alerts.`
                : alerts.length === 0
                  ? 'No heads breached the threshold this month.'
                  : `${alerts.length} head(s) flagged.`}
            </CardDescription>
          </CardHeader>
          {alerts.length > 0 && (
            <CardContent className="space-y-2">
              {alerts.map((row) => (
                <div
                  key={row.expenseHeadId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{row.expenseHeadName}</span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    <span>{formatINR(row.prior)} → {formatINR(row.current)}</span>
                    <Badge variant="secondary">
                      {row.deviationPercent != null
                        ? `${Number(row.deviationPercent) > 0 ? '+' : ''}${row.deviationPercent}%`
                        : 'no prior baseline'}
                    </Badge>
                  </span>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      </section>

      {/* (b) Month-on-month expense comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-on-month total expense</CardTitle>
          <CardDescription>
            {clinicId ? 'Selected clinic' : 'All clinics combined'}, {formatMonth(fromMonth)} –{' '}
            {formatMonth(toMonth)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTotalsChart data={monthly} />
        </CardContent>
      </Card>

      {/* (c) Expense-head-wise trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>Per-head totals across the selected months (bar &amp; line).</CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTrendCharts data={headTrends} />
        </CardContent>
      </Card>

      {/* (d) Clinic-wise total comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinic-wise total comparison</CardTitle>
          <CardDescription>Total provision per clinic over the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicTotalsChart data={clinicTotals} />
        </CardContent>
      </Card>
    </div>
  );
}

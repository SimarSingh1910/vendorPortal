import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { SubmissionStatus, SUBMISSION_STATUS_LABELS } from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  getHeadVendorTrends,
  getMonthlyTotals,
  getStatusTracker,
  getVariance,
  type DashboardFilter,
} from '@/api/dashboard';
import { StatusTiles } from '@/components/dashboard/StatusTiles';
import {
  ClinicTotalsChart,
  MonthlyTotalsChart,
  VarianceDivergingChart,
} from '@/components/dashboard/charts';
import { ChartTableView } from '@/components/dashboard/ChartTableView';
import { ExpenseHeadSplitBlock } from '@/components/dashboard/ExpenseHeadSplitBlock';
import { HeadTrendBlock } from '@/components/dashboard/HeadTrendBlock';
import { MonthSelect } from '@/components/dashboard/MonthSelect';
import { MultiSelect } from '@/components/dashboard/MultiSelect';
import { KpiRow, SubmissionPipeline } from '@/components/dashboard/DashboardKpis';
import {
  ClinicTotalsTable,
  MonthlyTotalsTable,
  StatusTable,
  VarianceTable,
} from '@/components/dashboard/dataTables';
import { formatMonth } from '@/lib/format';
import { buildHeadColorMap, headColor } from '@/lib/chartColors';

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

/** Months in [from, to] inclusive, newest first — options for the month picker. */
function monthsInRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  for (let m = to; m >= from && out.length <= 240; m = shiftMonth(m, -1)) out.push(m);
  return out;
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
// {id,name} items for the status multi-select (id = enum value, name = label).
const statusItems = STATUS_OPTIONS.map((s) => ({ id: s, name: SUBMISSION_STATUS_LABELS[s] }));

export function FinanceDashboard() {
  const thisMonth = currentMonth();
  // Multi-select filters (Clinic, SPOC, Status): `null` = All (the default); a Set
  // is the chosen subset. Empty is never reached — the control falls back to All.
  const [clinicIds, setClinicIds] = useState<Set<string> | null>(null);
  const [spocUserIds, setSpocUserIds] = useState<Set<string> | null>(null);
  const [statuses, setStatuses] = useState<Set<SubmissionStatus> | null>(null);
  const [expenseHeadId, setExpenseHeadId] = useState('');
  const [fromMonth, setFromMonth] = useState(shiftMonth(thisMonth, -11));
  const [toMonth, setToMonth] = useState(thisMonth);
  // Shared month focus for the trend, clinic-total and split cards. Empty = whole
  // range. `effectiveMonth` collapses to whole range if the pick leaves the range.
  const [viewMonth, setViewMonth] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  async function runExport(key: string, fn: () => Promise<void>) {
    setExporting(key);
    try {
      await fn();
    } finally {
      setExporting(null);
    }
  }

  // A `null` (All) selection sends nothing; a Set sends the chosen ids/statuses.
  const clinicIdList = clinicIds ? [...clinicIds] : undefined;
  const spocUserIdList = spocUserIds ? [...spocUserIds] : undefined;
  const statusList = statuses ? [...statuses] : undefined;
  // An explicitly emptied filter ("none" — every option unticked, incl. via the
  // "All" toggle) means NOTHING matches: the whole dashboard shows its empty state
  // until a selection is made (mirrors the expense-head 'none'), rather than
  // silently falling back to "all".
  const anyEmpty =
    (clinicIds !== null && clinicIds.size === 0) ||
    (spocUserIds !== null && spocUserIds.size === 0) ||
    (statuses !== null && statuses.size === 0);

  // `toMonth` is the as-of month for the status tracker + variance; the pair
  // (from, to) bounds the trend charts.
  const asOf = toMonth || thisMonth;
  const rangeFilter: DashboardFilter = {
    clinicIds: clinicIdList,
    spocUserIds: spocUserIdList,
    expenseHeadId: expenseHeadId || undefined,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: statusList,
  };

  // Exports are single-clinic-or-all by design (unchanged): pass a clinic/SPOC id
  // only when exactly one is selected, otherwise omit (all). Status lists already
  // flow through the export endpoints as-is.
  const soleClinicId = clinicIds && clinicIds.size === 1 ? [...clinicIds][0] : undefined;
  const soleSpocUserId = spocUserIds && spocUserIds.size === 1 ? [...spocUserIds][0] : undefined;
  const exportFilter: DashboardFilter = {
    clinicId: soleClinicId,
    spocUserId: soleSpocUserId,
    expenseHeadId: expenseHeadId || undefined,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: statusList,
  };

  // Month-picker options + the effective pick (whole range when unset / out of range).
  const monthOptions = useMemo(() => monthsInRange(fromMonth, toMonth), [fromMonth, toMonth]);
  const effectiveMonth = viewMonth && monthOptions.includes(viewMonth) ? viewMonth : '';
  // Clinic totals honour the picked month by narrowing the fetched range to it.
  const clinicFilter: DashboardFilter = effectiveMonth
    ? { ...rangeFilter, from: effectiveMonth, to: effectiveMonth }
    : rangeFilter;

  const { data: options } = useQuery({
    queryKey: ['dashboard', 'filters'],
    queryFn: getDashboardFilters,
  });
  // Data queries are SKIPPED while a filter is empty (`enabled: !anyEmpty`) — no
  // wasted fetch — and the results are forced to empty below so the cards show
  // their no-data state.
  const { data: tilesData = [], isLoading: tilesLoading } = useQuery({
    queryKey: ['dashboard', 'status', asOf, spocUserIdList],
    queryFn: () => getStatusTracker(asOf, spocUserIdList),
    enabled: !anyEmpty,
  });
  const { data: varianceData } = useQuery({
    queryKey: ['dashboard', 'variance', asOf, clinicIdList, spocUserIdList],
    queryFn: () => getVariance(asOf, clinicIdList, spocUserIdList),
    enabled: !anyEmpty,
  });
  const { data: monthlyData = [] } = useQuery({
    queryKey: ['dashboard', 'monthly', rangeFilter],
    queryFn: () => getMonthlyTotals(rangeFilter),
    placeholderData: keepPreviousData,
    enabled: !anyEmpty,
  });
  const { data: headTrendsData = [] } = useQuery({
    queryKey: ['dashboard', 'head-trends', rangeFilter],
    queryFn: () => getHeadTrends(rangeFilter),
    placeholderData: keepPreviousData,
    enabled: !anyEmpty,
  });
  const { data: headVendorTrendsData = [] } = useQuery({
    queryKey: ['dashboard', 'head-vendor-trends', rangeFilter],
    queryFn: () => getHeadVendorTrends(rangeFilter),
    placeholderData: keepPreviousData,
    enabled: !anyEmpty,
  });
  const { data: clinicTotalsData = [] } = useQuery({
    queryKey: ['dashboard', 'clinic-totals', clinicFilter],
    queryFn: () => getClinicTotals(clinicFilter),
    placeholderData: keepPreviousData,
    enabled: !anyEmpty,
  });

  // Empty selection → nothing matches: render every card empty (charts/tables all
  // handle []; variance falls to its "no data" state on undefined). The head-trend
  // views fold the same empty override into their useMemo (below).
  const tiles = anyEmpty ? [] : tilesData;
  const variance = anyEmpty ? undefined : varianceData;
  const monthly = anyEmpty ? [] : monthlyData;
  const clinicTotals = anyEmpty ? [] : clinicTotalsData;

  // Trend + pie share one client-side month filter (the head-trend query already
  // holds the whole range) — a specific month narrows to that month, NULL ≠ 0. The
  // empty-selection override folds in here (empty → [] → charts show no data).
  const headTrendsView = useMemo(() => {
    const base = anyEmpty ? [] : headTrendsData;
    return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
  }, [headTrendsData, effectiveMonth, anyEmpty]);
  // The vendor breakdown (Table views) honours the same focus-month as the trend.
  const headVendorTrendsView = useMemo(
    () => {
      const base = anyEmpty ? [] : headVendorTrendsData;
      return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
    },
    [headVendorTrendsData, effectiveMonth, anyEmpty],
  );

  // Master head→colour map (built from the full in-scope head list) so every
  // chart colours a head identically and a filtered head keeps its colour.
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

  // One shared month picker, rendered in each of the three cards' control rows so
  // they focus/blur the same month together (empty = whole range).
  const monthControl = (
    <MonthSelect value={effectiveMonth} options={monthOptions} onChange={setViewMonth} />
  );

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
            onClick={() => runExport('consolidated', () => exportConsolidated(exportFilter))}
          >
            <Download />
            {exporting === 'consolidated' ? 'Exporting…' : 'Excel'}
          </Button>
          {soleClinicId && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!exporting}
              onClick={() => runExport('clinic', () => exportClinicMonth(soleClinicId, asOf))}
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
            variant="outline"
            size="sm"
            disabled={!!exporting}
            onClick={() => runExport('pdf', () => exportDashboardPdf(exportFilter))}
          >
            <FileText />
            {exporting === 'pdf' ? 'Generating…' : 'PDF'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5">
          <Label>Clinic</Label>
          <MultiSelect
            items={options?.clinics ?? []}
            selected={clinicIds}
            onChange={setClinicIds}
            nounSingular="clinic"
            nounPlural="clinics"
            ariaLabel="Filter by clinic"
            allowEmpty
            fullWidth
          />
        </div>
        <div className="space-y-1.5">
          <Label>Clinic SPOC</Label>
          <MultiSelect
            items={options?.spocs ?? []}
            selected={spocUserIds}
            onChange={setSpocUserIds}
            nounSingular="SPOC"
            nounPlural="SPOCs"
            ariaLabel="Filter by clinic SPOC"
            allowEmpty
            fullWidth
          />
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
          <MultiSelect
            items={statusItems}
            selected={statuses}
            onChange={setStatuses}
            nounSingular="status"
            nounPlural="statuses"
            ariaLabel="Filter by status"
            allowEmpty
            fullWidth
          />
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
          <ChartTableView
            chart={<StatusTiles tiles={tiles} />}
            table={<StatusTable tiles={tiles} />}
          />
        )}
      </section>

      {/* KPI headline row */}
      <KpiRow monthly={monthly} tiles={tiles} variance={variance} asOf={asOf} />

      {/* (b) Month-on-month total + submission pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Month-on-month total provision</CardTitle>
            <CardDescription>Bars labelled; dashed line = range average.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartTableView
              chart={<MonthlyTotalsChart data={monthly} />}
              table={<MonthlyTotalsTable data={monthly} />}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission pipeline</CardTitle>
            <CardDescription>Where clinics stand for {formatMonth(asOf)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <SubmissionPipeline tiles={tiles} />
          </CardContent>
        </Card>
      </div>

      {/* (c) Expense-head-wise trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>
            Per-head totals (bars) and momentum indexed to each head&apos;s first month (line).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTrendBlock
            data={headTrendsView}
            colorOf={colorOf}
            monthControl={monthControl}
            vendorData={headVendorTrendsView}
          />
        </CardContent>
      </Card>

      {/* (d) Clinic-wise total + Expense-head split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clinic-wise total</CardTitle>
            <CardDescription>Ranked, with share of total.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartTableView
              controls={monthControl}
              chart={<ClinicTotalsChart data={clinicTotals} />}
              table={<ClinicTotalsTable data={clinicTotals} />}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense-head split</CardTitle>
            <CardDescription>Share of provision by head over the range.</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpenseHeadSplitBlock
              data={headTrendsView}
              colorOf={colorOf}
              monthControl={monthControl}
              vendorData={headVendorTrendsView}
            />
          </CardContent>
        </Card>
      </div>

      {/* (e) Variance vs prior month — full width */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variance vs prior month</CardTitle>
          <CardDescription>
            Δ% {variance ? formatMonth(variance.priorMonth) : '—'} → {formatMonth(asOf)}
            {variance?.thresholdPercent != null
              ? ` · shaded band = ±${variance.thresholdPercent}% threshold`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {variance && variance.rows.length > 0 ? (
            <ChartTableView
              chart={<VarianceDivergingChart report={variance} />}
              table={<VarianceTable report={variance} />}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No variance data for {formatMonth(asOf)} yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getClinicTotals,
  getDashboardFilters,
  getHeadTrends,
  getHeadVendorTrends,
  getMonthlyTotals,
  getStatusTracker,
  getVariance,
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
import { KpiRow, SubmissionPipeline } from '@/components/dashboard/DashboardKpis';
import { DashboardExportButtons } from '@/components/dashboard/DashboardExportButtons';
import { DashboardFilterBar } from '@/components/dashboard/DashboardFilterBar';
import { useDashboardFilters } from '@/components/dashboard/useDashboardFilters';
import {
  ClinicTotalsTable,
  MonthlyTotalsTable,
  StatusTable,
  VarianceTable,
} from '@/components/dashboard/dataTables';
import { formatMonth } from '@/lib/format';
import { buildHeadColorMap, headColor } from '@/lib/chartColors';

export function FinanceDashboard() {
  // Filter state, query payloads and the export payload all come from the shared
  // hook — the clinic dashboard uses the very same one, so the two screens cannot
  // drift apart. What differs between them is the OPTION LISTS the API returns.
  const filters = useDashboardFilters();
  const { anyEmpty, asOf, rangeFilter, clinicFilter, clinicIdList, spocUserIdList } = filters;

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
  const { effectiveMonth } = filters;

  // Trend + pie share one client-side month filter (the head-trend query already
  // holds the whole range) — a specific month narrows to that month, NULL ≠ 0. The
  // empty-selection override folds in here (empty → [] → charts show no data).
  const headTrendsView = useMemo(() => {
    const base = anyEmpty ? [] : headTrendsData;
    return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
  }, [headTrendsData, effectiveMonth, anyEmpty]);
  // The vendor breakdown (Table views) honours the same focus-month as the trend.
  const headVendorTrendsView = useMemo(() => {
    const base = anyEmpty ? [] : headVendorTrendsData;
    return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
  }, [headVendorTrendsData, effectiveMonth, anyEmpty]);

  // Master head→colour map (built from the full in-scope head list) so every
  // chart colours a head identically and a filtered head keeps its colour.
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

  // One shared month picker, rendered in each of the three cards' control rows so
  // they focus/blur the same month together (empty = whole range).
  const monthControl = (
    <MonthSelect
      value={effectiveMonth}
      options={filters.monthOptions}
      onChange={filters.setViewMonth}
    />
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
        <DashboardExportButtons filters={filters} />
      </div>

      {/* Filters */}
      <DashboardFilterBar options={options} filters={filters} />

      {/* (a) Status tracker */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Submission status — {formatMonth(asOf)}
        </h2>
        {tilesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ChartTableView
            // Grouped into the finance manager's three stage columns. The tiles are
            // whatever the active filters left in `tiles`, so grouping applies to
            // the filtered set rather than fighting it.
            chart={<StatusTiles tiles={tiles} grouped />}
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

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { UserRole } from '@portal/shared';
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
import { getOverview } from '@/api/submissions';
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
import { ClinicApprovedHistory } from '@/components/submissions/ClinicApprovedHistory';
import { buildHeadColorMap, headColor } from '@/lib/chartColors';
import { formatMonth } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

/**
 * SPOC / Cluster-Manager dashboard (Step 11.2, extended in 11.3).
 *
 * Carries the SAME analytic blocks as the finance dashboard — status tracker, KPI
 * row, month-on-month total, submission pipeline, head-wise trend, clinic-wise
 * total, expense-head split and the variance-vs-prior-month deviation chart — and
 * now the same two capabilities finance had to itself: the EXCEL/PDF EXPORT and the
 * FULL FILTER ROW. A SPOC or cluster manager checking their own numbers needs the
 * same lenses finance uses to question them; withholding the deviation chart in
 * particular meant the person who can actually FIX an outlier was the one who
 * couldn't see it flagged, and withholding the export meant they couldn't take
 * their own figures into a spreadsheet to reconcile them.
 *
 * SCOPE IS STILL NOT THIS SCREEN'S JOB — and deliberately so. Every one of these
 * endpoints resolves its clinics through `resolveClinicIds`, which intersects any
 * request with the caller's `accessibleClinicIds`; the export endpoints do the same
 * through `ExportService`, and reject an out-of-scope clinic id with a 403 instead
 * of widening. So this screen sends the identical payloads the finance screen does
 * and still gets back only the caller's own clinics. Sharing the filter bar and the
 * export buttons with finance therefore grants no extra reach: the option lists
 * arrive pre-narrowed, and the server re-checks regardless of what is sent.
 */
export function ClinicDashboard() {
  const role = useAuthStore((s) => s.user?.role);
  const linkBase = role === UserRole.CLINIC_MANAGER ? '/manager/submissions' : '/spoc/submissions';

  // Identical filter state to the finance dashboard (shared hook).
  const filters = useDashboardFilters();
  const { anyEmpty, asOf, rangeFilter, clinicFilter, clinicIdList, spocUserIdList } = filters;

  const { data: options } = useQuery({
    queryKey: ['dashboard', 'filters'],
    queryFn: getDashboardFilters,
  });
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
  const { data: clinics = [] } = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
  });

  // An explicitly emptied filter means nothing matches — render every card empty.
  const tiles = anyEmpty ? [] : tilesData;
  const variance = anyEmpty ? undefined : varianceData;
  const monthly = anyEmpty ? [] : monthlyData;
  const clinicTotals = anyEmpty ? [] : clinicTotalsData;
  const { effectiveMonth } = filters;

  const headTrendsView = useMemo(() => {
    const base = anyEmpty ? [] : headTrendsData;
    return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
  }, [headTrendsData, effectiveMonth, anyEmpty]);
  const headVendorTrendsView = useMemo(() => {
    const base = anyEmpty ? [] : headVendorTrendsData;
    return effectiveMonth ? base.filter((d) => d.month === effectiveMonth) : base;
  }, [headVendorTrendsData, effectiveMonth, anyEmpty]);

  // Same master head→colour map as the finance dashboard, so a head keeps one
  // colour everywhere (filter options return the full in-scope head list).
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

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
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your clinic’s status, trends and variance — the same views finance sees, for
            your assigned clinics only.
          </p>
        </div>
        {/* Identical to finance, month-end included — every one of these endpoints
            resolves its clinics from the caller's own scope, so the same buttons
            yield this role's clinics rather than the org's. */}
        <DashboardExportButtons filters={filters} />
      </div>

      {/* Filters — same controls as finance, options pre-scoped by the API. */}
      <DashboardFilterBar options={options} filters={filters} />

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

      {/* KPI headline row — same figures finance reads, over your clinics only. */}
      <KpiRow monthly={monthly} tiles={tiles} variance={variance} asOf={asOf} />

      {/* Month-on-month total + submission pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Month-on-month total expense</CardTitle>
            <CardDescription>Your clinic’s total provision over the last months.</CardDescription>
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
            <CardDescription>Where you stand for {formatMonth(asOf)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <SubmissionPipeline tiles={tiles} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>Per-head totals across the recent months.</CardDescription>
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

      {/* Clinic-wise total + Expense-head split. The clinic-wise chart is a single
          ranked bar for a one-clinic SPOC and a real comparison for anyone covering
          several — either way it only ever lists clinics they're assigned to. */}
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

      {/* Variance vs prior month — the deviation chart, full width. This is the one
          that tells a SPOC which of their own heads finance is about to ask about. */}
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Past approved months</h2>
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing approved yet.</p>
        ) : (
          clinics.map((clinic) => (
            <ClinicApprovedHistory
              key={clinic.clinicId}
              clinicId={clinic.clinicId}
              clinicName={clinic.clinicName}
              linkBase={linkBase}
            />
          ))
        )}
      </section>
    </div>
  );
}

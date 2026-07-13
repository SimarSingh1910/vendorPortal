import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CorpSubmissionStatus, type CorpDepartmentMonthStatus } from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  getCorpDashboardFilters,
  getCorpHeadTrends,
  getCorpMonthlyTotals,
  getCorpStatusTracker,
} from '@/api/corpDashboard';
import { getCorpDepartmentHistory, getCorpOverview } from '@/api/corpSubmissions';
import { MonthlyTotalsChart } from '@/components/dashboard/charts';
import { CorpStatusTiles, CorpStatusTable } from '@/components/dashboard/CorpStatusTiles';
import { ChartTableView } from '@/components/dashboard/ChartTableView';
import { HeadTrendBlock } from '@/components/dashboard/HeadTrendBlock';
import { MonthlyTotalsTable } from '@/components/dashboard/dataTables';
import { buildHeadColorMap, headColor } from '@/lib/chartColors';
import { formatMonth } from '@/lib/format';
import { currentMonthIST } from '@/lib/corpFormat';

/**
 * DEPT_SPOC / DEPT_VIEWER dashboard (Step C4.2). Everything is department-scoped
 * by the API (these roles only ever see their assigned departments — a multi-dept
 * SPOC sees each), so it reuses the same analytics endpoints as the finance
 * consolidated dashboard with no department filter. A presentation/read layer
 * (reads write no audit).
 */
export function CorpMyDashboard() {
  const month = currentMonthIST();

  const { data: tiles = [], isLoading: tilesLoading } = useQuery({
    queryKey: ['corp', 'dashboard', 'status', 'mine'],
    queryFn: () => getCorpStatusTracker(),
  });
  const { data: monthly = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'monthly', 'mine'],
    queryFn: () => getCorpMonthlyTotals({}),
  });
  const { data: headTrends = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'head-trends', 'mine'],
    queryFn: () => getCorpHeadTrends({}),
  });
  const { data: overview = [] } = useQuery({
    queryKey: ['corp', 'overview', month],
    queryFn: () => getCorpOverview(month),
  });
  const { data: options } = useQuery({
    queryKey: ['corp', 'dashboard', 'filters'],
    queryFn: getCorpDashboardFilters,
  });

  // Same master head→colour map approach as the finance dashboard, so a head
  // keeps one colour everywhere (filter options return the full in-scope list).
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your department’s current status and month-on-month provision trend.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Current month — {formatMonth(month)}
        </h2>
        {tilesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ChartTableView
            chart={<CorpStatusTiles tiles={tiles} />}
            table={<CorpStatusTable tiles={tiles} />}
          />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-on-month total provision</CardTitle>
          <CardDescription>Your department’s total over the recent months.</CardDescription>
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
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>Per-head totals across the recent months.</CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTrendBlock data={headTrends} colorOf={colorOf} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Past approved months</h2>
        {overview.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments in your scope.</p>
        ) : (
          overview.map((dept) => <CorpDeptApprovedHistory key={dept.departmentId} dept={dept} />)
        )}
      </section>
    </div>
  );
}

/** Read-only list of a department's approved months, linking to the locked form. */
function CorpDeptApprovedHistory({ dept }: { dept: CorpDepartmentMonthStatus }) {
  const { data: history = [] } = useQuery({
    queryKey: ['corp', 'history', dept.departmentId],
    queryFn: () => getCorpDepartmentHistory(dept.departmentId),
  });
  const approved = history.filter((s) => s.status === CorpSubmissionStatus.FINANCE_APPROVED);

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">{dept.departmentName}</h3>
      {approved.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No approved months yet.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {approved.map((s) => (
            <li key={s.id}>
              <Button asChild variant="outline" size="sm">
                <Link to={`/corporate/submissions/${s.id}`}>{formatMonth(s.month)}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

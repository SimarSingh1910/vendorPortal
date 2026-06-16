import { useQuery } from '@tanstack/react-query';
import { UserRole } from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getHeadTrends, getMonthlyTotals, getStatusTracker } from '@/api/dashboard';
import { getOverview } from '@/api/submissions';
import { StatusTiles } from '@/components/dashboard/StatusTiles';
import { HeadTrendCharts, MonthlyTotalsChart } from '@/components/dashboard/charts';
import { ClinicApprovedHistory } from '@/components/submissions/ClinicApprovedHistory';
import { useAuthStore } from '@/store/auth.store';

/**
 * SPOC / Manager dashboard (Step 11.2). Everything is clinic-scoped by the API
 * (these roles only ever see their assigned clinics), so it reuses the same
 * analytics endpoints as the finance dashboard with no clinic filter.
 */
export function ClinicDashboard() {
  const role = useAuthStore((s) => s.user?.role);
  const linkBase = role === UserRole.CLINIC_MANAGER ? '/manager/submissions' : '/spoc/submissions';

  const { data: tiles = [], isLoading: tilesLoading } = useQuery({
    queryKey: ['dashboard', 'status', 'mine'],
    queryFn: () => getStatusTracker(),
  });
  const { data: monthly = [] } = useQuery({
    queryKey: ['dashboard', 'monthly', 'mine'],
    queryFn: () => getMonthlyTotals({}),
  });
  const { data: headTrends = [] } = useQuery({
    queryKey: ['dashboard', 'head-trends', 'mine'],
    queryFn: () => getHeadTrends({}),
  });
  const { data: clinics = [] } = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your clinic’s current status and month-on-month expense trend.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Current month</h2>
        {tilesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <StatusTiles tiles={tiles} />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-on-month total expense</CardTitle>
          <CardDescription>Your clinic’s total provision over the last months.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTotalsChart data={monthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>Per-head totals across the recent months.</CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTrendCharts data={headTrends} />
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

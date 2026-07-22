import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { CorpSubmissionStatus, type CorpSec24MonthPoint } from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getCorpDashboardFilters,
  getCorpDepartmentTotals,
  getCorpHeadTrends,
  getCorpMonthlyTotals,
  getCorpSec24,
  getCorpStatusTracker,
  getCorpVariance,
  type CorpDashboardFilter,
} from '@/api/corpDashboard';
import { MonthlyTotalsChart, VarianceDivergingChart } from '@/components/dashboard/charts';
import { CorpDepartmentTotalsChart } from '@/components/dashboard/CorpDepartmentTotalsChart';
import { CorpStatusTiles, CorpStatusTable } from '@/components/dashboard/CorpStatusTiles';
import { ChartTableView } from '@/components/dashboard/ChartTableView';
import { HeadTrendBlock } from '@/components/dashboard/HeadTrendBlock';
import { KpiRow, SubmissionPipeline } from '@/components/dashboard/DashboardKpis';
import { MonthlyTotalsTable, VarianceTable } from '@/components/dashboard/dataTables';
import { exportCorpMonthEnd } from '@/api/export';
import { formatINR, formatMonth } from '@/lib/format';
import { corpStatusLabel, currentMonthIST } from '@/lib/corpFormat';
import { buildHeadColorMap, headColor } from '@/lib/chartColors';

/** Shift a YYYY-MM month by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A native, Input-styled select for the filter row (no shared Select component). */
function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
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

const STATUS_OPTIONS = Object.values(CorpSubmissionStatus);

/**
 * (f) Sec 24 dual display: total | HCL Avitas share | % used. Reads FROZEN values
 * verbatim — null renders "—", NEVER 0 (a real 0.00 stays distinct). No recompute.
 */
function Sec24DualTable({ data }: { data: CorpSec24MonthPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No Sec 24 shared-cost-pool data for the selected range.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Total provision (₹)</TableHead>
          <TableHead className="text-right">HCL Avitas share (₹)</TableHead>
          <TableHead className="text-right">% used</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((p) => (
          <TableRow key={p.month}>
            <TableCell className="font-medium">{formatMonth(p.month)}</TableCell>
            <TableCell className="text-right">{formatINR(p.total)}</TableCell>
            {/* null share → "—", never 0; formatINR already maps null to "—". */}
            <TableCell className="text-right">{formatINR(p.hclAvitasShare)}</TableCell>
            <TableCell className="text-right">
              {p.allocationPct !== null ? `${p.allocationPct}%` : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** (d) Tabular cross-department totals. */
function CorpDepartmentTotalsTable({
  data,
}: {
  data: { departmentId: string; departmentName: string; total: string }[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No department totals for the selected range.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Department</TableHead>
          <TableHead className="text-right">Total (₹)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.departmentId}>
            <TableCell className="font-medium">{d.departmentName}</TableCell>
            <TableCell className="text-right">{formatINR(d.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CorporateDashboard() {
  const thisMonth = currentMonthIST();
  const [departmentId, setDepartmentId] = useState('');
  const [expenseHeadId, setExpenseHeadId] = useState('');
  const [budgetCodeId, setBudgetCodeId] = useState('');
  const [status, setStatus] = useState('');
  const [fromMonth, setFromMonth] = useState(shiftMonth(thisMonth, -11));
  const [toMonth, setToMonth] = useState(thisMonth);

  // `toMonth` is the as-of month for status + variance; (from, to) bounds the trends.
  const asOf = toMonth || thisMonth;
  const rangeFilter: CorpDashboardFilter = {
    departmentId: departmentId || undefined,
    expenseHeadId: expenseHeadId || undefined,
    budgetCodeId: budgetCodeId || undefined,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: status ? [status as CorpSubmissionStatus] : undefined,
  };

  const { data: options } = useQuery({
    queryKey: ['corp', 'dashboard', 'filters'],
    queryFn: getCorpDashboardFilters,
  });
  const { data: tiles = [], isLoading: tilesLoading } = useQuery({
    queryKey: ['corp', 'dashboard', 'status', asOf],
    queryFn: () => getCorpStatusTracker(asOf),
  });
  const { data: variance } = useQuery({
    queryKey: ['corp', 'dashboard', 'variance', asOf, departmentId],
    queryFn: () => getCorpVariance(asOf, departmentId || undefined),
  });
  const { data: monthly = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'monthly', rangeFilter],
    queryFn: () => getCorpMonthlyTotals(rangeFilter),
    placeholderData: keepPreviousData,
  });
  const { data: headTrends = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'head-trends', rangeFilter],
    queryFn: () => getCorpHeadTrends(rangeFilter),
    placeholderData: keepPreviousData,
  });
  const { data: deptTotals = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'dept-totals', rangeFilter],
    queryFn: () => getCorpDepartmentTotals(rangeFilter),
    placeholderData: keepPreviousData,
  });
  const { data: sec24 = [] } = useQuery({
    queryKey: ['corp', 'dashboard', 'sec24', rangeFilter],
    queryFn: () => getCorpSec24(rangeFilter),
    placeholderData: keepPreviousData,
  });

  // Master head→colour map so a head keeps its colour across charts/filters.
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Corporate Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Submission tracking, expense trends, cross-department totals, Sec 24 share and variance
            alerts across corporate departments.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void exportCorpMonthEnd(asOf)}>
          <Download />
          Month-end Excel ({formatMonth(asOf)})
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5">
          <Label>Department</Label>
          <Select value={departmentId} onChange={setDepartmentId}>
            <option value="">All departments</option>
            {options?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
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
          <Label>Budget code</Label>
          <Select value={budgetCodeId} onChange={setBudgetCodeId}>
            <option value="">All budget codes</option>
            {options?.budgetCodes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
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
                {corpStatusLabel(s)}
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
          <ChartTableView
            chart={<CorpStatusTiles tiles={tiles} />}
            table={<CorpStatusTable tiles={tiles} />}
          />
        )}
      </section>

      {/* KPI headline row */}
      <KpiRow monthly={monthly} tiles={tiles} variance={variance} asOf={asOf} unit="department" />

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
            <CardDescription>Where departments stand for {formatMonth(asOf)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <SubmissionPipeline tiles={tiles} unit="department" />
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
          <HeadTrendBlock data={headTrends} colorOf={colorOf} />
        </CardContent>
      </Card>

      {/* (d) Cross-department total + (e) Variance vs prior month */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Department-wise total</CardTitle>
            <CardDescription>Ranked, with share of total.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartTableView
              chart={<CorpDepartmentTotalsChart data={deptTotals} />}
              table={<CorpDepartmentTotalsTable data={deptTotals} />}
            />
          </CardContent>
        </Card>
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

      {/* (f) Sec 24 shared-cost-pool dual display */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sec 24 shared-cost pool</CardTitle>
          <CardDescription>
            Total provision, frozen HCL Avitas share and the % used per month. A dash (—) means no
            allocation % has been set/frozen yet — distinct from a real 0%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Sec24DualTable data={sec24} />
        </CardContent>
      </Card>
    </div>
  );
}

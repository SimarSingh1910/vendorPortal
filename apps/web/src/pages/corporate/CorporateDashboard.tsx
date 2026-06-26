import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  CorpSubmissionStatus,
  type CorpDashboardStatusTile,
  type CorpSec24MonthPoint,
} from '@portal/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { MonthlyTotalsChart } from '@/components/dashboard/charts';
import { CorpDepartmentTotalsChart } from '@/components/dashboard/CorpDepartmentTotalsChart';
import { ChartTableView } from '@/components/dashboard/ChartTableView';
import { HeadTrendBlock } from '@/components/dashboard/HeadTrendBlock';
import { MonthlyTotalsTable, VarianceTable } from '@/components/dashboard/dataTables';
import { formatINR, formatMonth } from '@/lib/format';
import { corpStatusBadgeVariant, corpStatusLabel, currentMonthIST } from '@/lib/corpFormat';
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

/** (a) Per-department status tiles for the as-of month. */
function CorpStatusTiles({ tiles }: { tiles: CorpDashboardStatusTile[] }) {
  if (tiles.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No departments in scope.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.departmentId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.departmentName}</CardTitle>
            <CardDescription>
              <Badge variant={corpStatusBadgeVariant(t.status)}>{corpStatusLabel(t.status)}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{formatINR(t.total)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** (a) Tabular view of the same status tiles. */
function CorpStatusTable({ tiles }: { tiles: CorpDashboardStatusTile[] }) {
  if (tiles.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No departments in scope.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Department</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total entered (₹)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tiles.map((t) => (
          <TableRow key={t.departmentId}>
            <TableCell className="font-medium">{t.departmentName}</TableCell>
            <TableCell>
              <Badge variant={corpStatusBadgeVariant(t.status)}>{corpStatusLabel(t.status)}</Badge>
            </TableCell>
            <TableCell className="text-right">{formatINR(t.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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

  const alerts = variance?.rows.filter((r) => r.flagged) ?? [];

  // Master head→colour map so a head keeps its colour across charts/filters.
  const colorMap = useMemo(() => buildHeadColorMap(options?.expenseHeads ?? []), [options]);
  const colorOf = useMemo(() => (id: string) => headColor(colorMap, id), [colorMap]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Corporate Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Submission tracking, expense trends, cross-department totals, Sec 24 share and variance
          alerts across corporate departments.
        </p>
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

      {/* (e) Variance alerts */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Variance alerts — {formatMonth(asOf)} vs{' '}
          {variance ? formatMonth(variance.priorMonth) : '—'}
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
          {variance && variance.rows.length > 0 && (
            <CardContent>
              <ChartTableView
                chart={
                  alerts.length > 0 ? (
                    <div className="space-y-2">
                      {alerts.map((row) => (
                        <div
                          key={row.expenseHeadId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                        >
                          <span className="font-medium">{row.expenseHeadName}</span>
                          <span className="flex items-center gap-3 text-muted-foreground">
                            <span>
                              {formatINR(row.prior)} → {formatINR(row.current)}
                            </span>
                            <Badge variant="secondary">
                              {row.deviationPercent != null
                                ? `${Number(row.deviationPercent) > 0 ? '+' : ''}${row.deviationPercent}%`
                                : 'no prior baseline'}
                            </Badge>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No heads breached the threshold this month. Switch to the table to see every
                      head’s movement.
                    </p>
                  )
                }
                table={<VarianceTable report={variance} />}
              />
            </CardContent>
          )}
        </Card>
      </section>

      {/* (b) Month-on-month combined expense */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-on-month total provision</CardTitle>
          <CardDescription>
            {departmentId ? 'Selected department' : 'All departments combined'},{' '}
            {formatMonth(fromMonth)} – {formatMonth(toMonth)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartTableView
            chart={<MonthlyTotalsChart data={monthly} />}
            table={<MonthlyTotalsTable data={monthly} />}
          />
        </CardContent>
      </Card>

      {/* (c) Expense-head-wise trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense-head-wise trend</CardTitle>
          <CardDescription>Per-head totals across the selected months (bar &amp; line).</CardDescription>
        </CardHeader>
        <CardContent>
          <HeadTrendBlock data={headTrends} colorOf={colorOf} />
        </CardContent>
      </Card>

      {/* (d) Cross-department total comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department-wise total comparison</CardTitle>
          <CardDescription>Total provision per department over the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartTableView
            chart={<CorpDepartmentTotalsChart data={deptTotals} />}
            table={<CorpDepartmentTotalsTable data={deptTotals} />}
          />
        </CardContent>
      </Card>

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

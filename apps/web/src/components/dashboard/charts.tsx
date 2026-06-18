import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ClinicTotalPoint,
  HeadTrendPoint,
  MonthlyTotalPoint,
  MonthwiseReport,
} from '@portal/shared';
import { formatINR } from '@/lib/format';

/** Distinct, reasonably colour-blind-friendly series colours. */
const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
];

/** 'YYYY-MM' → 'Jun 26' for compact axis labels. */
function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/** Compact INR for Y-axis ticks (₹1.2L / ₹3.4Cr). */
function compactINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n}`;
}

const moneyTooltip = (value: number | string) => formatINR(value as number);

function Empty({ label }: { label: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{label}</p>;
}

/** (b) Month-on-month total expense, as bars. */
export function MonthlyTotalsChart({ data }: { data: MonthlyTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No expense data for the selected range." />;
  const rows = data.map((p) => ({ month: p.month, total: Number(p.total) }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
          <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
          <Bar dataKey="total" name="Total" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pivot (month, head) points into one row per month with a column per head. */
function pivotHeads(data: HeadTrendPoint[]) {
  const months = [...new Set(data.map((d) => d.month))].sort();
  const heads = [...new Map(data.map((d) => [d.expenseHeadId, d.expenseHeadName])).values()];
  const rows = months.map((month) => {
    const row: Record<string, number | string> = { month };
    for (const head of heads) row[head] = 0;
    for (const d of data) if (d.month === month) row[d.expenseHeadName] = Number(d.total);
    return row;
  });
  return { rows, heads };
}

/** (c) Expense-head-wise trend — grouped bars AND lines over the months. */
export function HeadTrendCharts({ data }: { data: HeadTrendPoint[] }) {
  if (data.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const { rows, heads } = pivotHeads(data);
  return (
    <div className="space-y-6">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
            <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
            <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
            <Legend />
            {heads.map((head, i) => (
              <Bar key={head} dataKey={head} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
            <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
            <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
            <Legend />
            {heads.map((head, i) => (
              <Line
                key={head}
                type="monotone"
                dataKey={head}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Month-wise clinic report as per-head lines over the window (Step 4 panel chart view). */
export function MonthwiseChart({ report }: { report: MonthwiseReport }) {
  if (report.rows.length === 0) return <Empty label="No figures recorded in this window yet." />;
  // One recharts row per month; a numeric column per head (null gaps → 0 for plotting).
  const rows = report.months.map((month, i) => {
    const row: Record<string, number | string> = { month };
    for (const head of report.rows) row[head.expenseHeadName] = Number(head.values[i] ?? 0);
    return row;
  });
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
          <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
          <Legend />
          {report.rows.map((head, i) => (
            <Line
              key={head.expenseHeadId}
              type="monotone"
              dataKey={head.expenseHeadName}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** (d) Clinic-wise totals over the range, as horizontal bars. */
export function ClinicTotalsChart({ data }: { data: ClinicTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No clinic totals for the selected range." />;
  const rows = data.map((c) => ({ clinic: c.clinicName, total: Number(c.total) }));
  return (
    <div className="w-full" style={{ height: Math.max(180, rows.length * 40 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={compactINR} fontSize={12} />
          <YAxis type="category" dataKey="clinic" width={140} fontSize={12} />
          <Tooltip formatter={moneyTooltip} />
          <Bar dataKey="total" name="Total" fill={PALETTE[1]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

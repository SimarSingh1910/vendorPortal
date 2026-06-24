import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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
import { buildHeadColorMap, colorByIndex, headColor } from '@/lib/chartColors';

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

/**
 * A "nice" rounding increment (1/2/5 × 10ⁿ) sized to span ~4 ticks across the
 * given span — e.g. ~0.1L/0.2L steps for lakh-scale ranges — so fitted axis
 * bounds and ticks land on tidy values instead of arbitrary data extremes.
 */
function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const target = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Fit a line-chart y-axis to its data so month-on-month movement is readable:
 * domain = [min − pad, max + pad] (pad ≈ 13% of the spread) rounded out to clean
 * tick bounds. Returns `undefined` to defer to recharts' default (zero-based)
 * domain when there's no data. Edge cases — a single point or a flat series
 * (max == min) — fall back to value ± ~10% so the axis can't collapse. The lower
 * bound is clamped at ₹0 (expenses are non-negative).
 */
function fitLineDomain(values: number[]): [number, number] | undefined {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return undefined;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (nums.length === 1 || min === max) {
    const pad = Math.abs(max) * 0.1 || 1;
    const step = niceStep(pad);
    return [Math.max(0, Math.floor((max - pad) / step) * step), Math.ceil((max + pad) / step) * step];
  }
  const pad = (max - min) * 0.13;
  const step = niceStep(max - min);
  return [Math.max(0, Math.floor((min - pad) / step) * step), Math.ceil((max + pad) / step) * step];
}

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
          <Bar dataKey="total" name="Total" fill={colorByIndex(0)} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pivot (month, head) points into one row per month with a column per head. */
function pivotHeads(data: HeadTrendPoint[]) {
  const months = [...new Set(data.map((d) => d.month))].sort();
  const byId = new Map<string, string>();
  for (const d of data) byId.set(d.expenseHeadId, d.expenseHeadName);
  const heads = [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = months.map((month) => {
    const row: Record<string, number | string> = { month };
    for (const head of heads) row[head.name] = 0;
    for (const d of data) if (d.month === month) row[d.expenseHeadName] = Number(d.total);
    return row;
  });
  return { rows, heads };
}

/**
 * (c) Expense-head-wise trend — grouped bars AND lines over the months. Each head
 * is coloured by `colorOf(headId)` so it matches its colour in every other chart;
 * with a single head the legend naturally collapses to that one series. When no
 * `colorOf` is given, a stable name-ordered map is derived from the data.
 */
export function HeadTrendCharts({
  data,
  colorOf,
}: {
  data: HeadTrendPoint[];
  colorOf?: (id: string) => string;
}) {
  if (data.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const { rows, heads } = pivotHeads(data);
  const localMap = buildHeadColorMap(heads);
  const resolve = colorOf ?? ((id: string) => headColor(localMap, id));

  // Single-head mode: one series, so we can fit the line axis to the data and
  // label each bar. "All heads" stays multi-series — fitting/labelling a wide
  // grouped view doesn't help, so it keeps the default zero-based axis.
  const single = heads.length === 1 ? heads[0] : null;
  const lineDomain = single
    ? fitLineDomain(rows.map((r) => Number(r[single.name])))
    : undefined;

  return (
    <div className="space-y-6">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
            {/* Bars stay zero-based: bar length encodes magnitude. */}
            <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
            <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
            <Legend />
            {heads.map((head) => (
              <Bar key={head.id} dataKey={head.name} fill={resolve(head.id)} radius={[3, 3, 0, 0]}>
                {single && (
                  <LabelList
                    dataKey={head.name}
                    position="top"
                    fontSize={11}
                    formatter={(v: number | string) => formatINR(v as number)}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
            {/* Single head: fit the axis to the data so month-on-month movement
                is visible. All heads: defer to the default zero-based domain. */}
            <YAxis tickFormatter={compactINR} fontSize={12} width={70} domain={lineDomain} />
            <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
            <Legend />
            {heads.map((head) => (
              <Line
                key={head.id}
                type="monotone"
                dataKey={head.name}
                stroke={resolve(head.id)}
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
  const colorMap = buildHeadColorMap(
    report.rows.map((h) => ({ id: h.expenseHeadId, name: h.expenseHeadName })),
  );
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
          <Tooltip formatter={moneyTooltip} labelFormatter={(l) => shortMonth(String(l))} />
          <Legend />
          {report.rows.map((head) => (
            <Line
              key={head.expenseHeadId}
              type="monotone"
              dataKey={head.expenseHeadName}
              stroke={headColor(colorMap, head.expenseHeadId)}
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
          <Bar dataKey="total" name="Total" fill={colorByIndex(1)} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

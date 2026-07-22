import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
import {
  buildHeadColorMap,
  headColor,
  CHART_ANCHOR,
  CHART_ANCHOR_HOVER,
  CHART_AXIS_LABEL,
  CHART_GRID,
  CHART_LEGEND_TEXT,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_TEXT,
} from '@/lib/chartColors';

/** Token-aligned chart chrome: hairline grid + axis lines, muted tick labels. */
const gridStroke = CHART_GRID;
const axisTick = { fill: CHART_AXIS_LABEL } as const;
/** Tooltip surface + dark, neutral text (swatch/bullet keeps the series colour). */
const tooltipProps = {
  contentStyle: CHART_TOOLTIP_STYLE,
  labelStyle: { color: CHART_TOOLTIP_TEXT },
  itemStyle: { color: CHART_TOOLTIP_TEXT },
} as const;
/** Legend: neutral label text; the coloured swatch carries the series colour. */
const legendTextFormatter = (value: string) => (
  <span style={{ color: CHART_LEGEND_TEXT }}>{value}</span>
);

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

/**
 * Rebase each head to 100 at its first month with a positive value, so heads of
 * very different sizes are comparable by momentum (an ₹8L head and an ₹80k head
 * share one scale). Months before a head's first positive value stay `null`
 * (blank — never a fabricated 100), honouring NULL ≠ 0; a later 0/gap month is
 * likewise `null` so the line breaks rather than dropping to a fake baseline.
 */
function buildIndexedRows(
  rows: Array<Record<string, number | string>>,
  heads: Array<{ id: string; name: string }>,
): Array<Record<string, number | string | null>> {
  const baseline = new Map<string, number>();
  for (const head of heads) {
    for (const row of rows) {
      const v = Number(row[head.name]);
      if (Number.isFinite(v) && v > 0) {
        baseline.set(head.name, v);
        break;
      }
    }
  }
  return rows.map((row) => {
    const out: Record<string, number | string | null> = { month: row.month as string };
    for (const head of heads) {
      const base = baseline.get(head.name);
      const v = Number(row[head.name]);
      out[head.name] =
        base && Number.isFinite(v) && v > 0 ? Math.round((v / base) * 1000) / 10 : null;
    }
    return out;
  });
}

/**
 * Fit the indexed y-axis around the data while always keeping the 100 baseline
 * in view, padded out to tidy tick bounds. Falls back to [80, 120] when empty.
 */
function fitIndexDomain(
  rows: Array<Record<string, number | string | null>>,
  heads: Array<{ name: string }>,
): [number, number] {
  const vals: number[] = [];
  for (const row of rows) {
    for (const head of heads) {
      const v = row[head.name];
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length === 0) return [80, 120];
  const min = Math.min(100, ...vals);
  const max = Math.max(100, ...vals);
  const pad = Math.max((max - min) * 0.1, 5);
  const step = niceStep(max - min || 20);
  return [Math.max(0, Math.floor((min - pad) / step) * step), Math.ceil((max + pad) / step) * step];
}

/** Indexed-line tooltip: the index value plus its signed % change vs the base. */
const indexTooltip = (value: number | string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const pct = n - 100;
  return `${n.toFixed(1)}  ·  ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs first month`;
};

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
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
          <Tooltip
            {...tooltipProps}
            formatter={moneyTooltip}
            labelFormatter={(l) => shortMonth(String(l))}
          />
          <Bar
            dataKey="total"
            name="Total"
            fill={CHART_ANCHOR}
            stroke={CHART_ANCHOR}
            strokeWidth={1}
            activeBar={{ fill: CHART_ANCHOR_HOVER, stroke: CHART_ANCHOR_HOVER }}
            radius={[4, 4, 0, 0]}
          />
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

  // All-heads line becomes a momentum view: rebase each head to 100 at its
  // first month so growth rates are comparable across very different sizes.
  const indexedRows = single ? [] : buildIndexedRows(rows, heads);
  const indexDomain = single ? undefined : fitIndexDomain(indexedRows, heads);

  return (
    <div className="space-y-6">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              fontSize={12}
              stroke={gridStroke}
              tick={axisTick}
            />
            {/* Bars stay zero-based: bar length encodes magnitude. */}
            <YAxis
              tickFormatter={compactINR}
              fontSize={12}
              width={70}
              stroke={gridStroke}
              tick={axisTick}
            />
            <Tooltip
            {...tooltipProps}
            formatter={moneyTooltip}
            labelFormatter={(l) => shortMonth(String(l))}
          />
            <Legend formatter={legendTextFormatter} />
            {heads.map((head) => (
              <Bar
                key={head.id}
                dataKey={head.name}
                fill={resolve(head.id)}
                stroke={resolve(head.id)}
                strokeWidth={1}
                radius={[3, 3, 0, 0]}
              >
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
      {single ? (
        // Single head: actual-rupee line with the axis fitted to the data, so
        // one head's month-on-month movement is legible in real figures.
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="month"
                tickFormatter={shortMonth}
                fontSize={12}
                stroke={gridStroke}
                tick={axisTick}
              />
              <YAxis
                tickFormatter={compactINR}
                fontSize={12}
                width={70}
                domain={lineDomain}
                stroke={gridStroke}
                tick={axisTick}
              />
              <Tooltip
                {...tooltipProps}
                formatter={moneyTooltip}
                labelFormatter={(l) => shortMonth(String(l))}
              />
              <Legend formatter={legendTextFormatter} />
              <Line
                type="monotone"
                dataKey={single.name}
                stroke={resolve(single.id)}
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        // All heads: momentum view. Each head is rebased to 100 at its first
        // month, so heads of wildly different sizes are comparable by growth
        // rate instead of collapsing into a magnitude-dominated spaghetti.
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Momentum — each head indexed to 100 at its first month (a value of 120 = up 20% since
            then). Compares growth, not size.
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={indexedRows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis
                  dataKey="month"
                  tickFormatter={shortMonth}
                  fontSize={12}
                  stroke={gridStroke}
                  tick={axisTick}
                />
                <YAxis
                  fontSize={12}
                  width={70}
                  domain={indexDomain}
                  stroke={gridStroke}
                  tick={axisTick}
                />
                {/* The 100 baseline every head starts from (the axis tick at
                    100 and the caption name it — no overflowing text label). */}
                <ReferenceLine
                  y={100}
                  stroke={CHART_AXIS_LABEL}
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={indexTooltip}
                  labelFormatter={(l) => shortMonth(String(l))}
                />
                <Legend formatter={legendTextFormatter} />
                {heads.map((head) => (
                  <Line
                    key={head.id}
                    type="monotone"
                    dataKey={head.name}
                    stroke={resolve(head.id)}
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
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
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} />
          <Tooltip
            {...tooltipProps}
            formatter={moneyTooltip}
            labelFormatter={(l) => shortMonth(String(l))}
          />
          <Legend formatter={legendTextFormatter} />
          {report.rows.map((head) => (
            <Line
              key={head.expenseHeadId}
              type="monotone"
              dataKey={head.expenseHeadName}
              stroke={headColor(colorMap, head.expenseHeadId)}
              strokeWidth={2.5}
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
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridStroke} />
          <XAxis
            type="number"
            tickFormatter={compactINR}
            fontSize={12}
            stroke={gridStroke}
            tick={axisTick}
          />
          <YAxis
            type="category"
            dataKey="clinic"
            width={140}
            fontSize={12}
            stroke={gridStroke}
            tick={axisTick}
          />
          <Tooltip {...tooltipProps} formatter={moneyTooltip} />
          <Bar
            dataKey="total"
            name="Total"
            fill={CHART_ANCHOR}
            stroke={CHART_ANCHOR}
            strokeWidth={1}
            activeBar={{ fill: CHART_ANCHOR_HOVER, stroke: CHART_ANCHOR_HOVER }}
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/format';
import { deriveHeadChanges, formatSignedINR, formatSignedPct } from '@/lib/headChange';
import {
  buildHeadColorMap,
  headColor,
  CHART_ANCHOR,
  CHART_ANCHOR_HOVER,
  CHART_AXIS_LABEL,
  CHART_GRID,
  CHART_LEGEND_TEXT,
  CHART_NEGATIVE,
  CHART_POSITIVE,
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

  // Single-head mode still labels each grouped bar with its rupee value; a wide
  // multi-head grouping doesn't benefit from per-bar labels.
  const single = heads.length === 1 ? heads[0] : null;

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
      {/* Change over the range: increases right/green, decreases left/red,
          ranked by the chosen metric. Replaces the old momentum line. */}
      <HeadChangeChart data={data} />
    </div>
  );
}

type ChangeMetric = 'pct' | 'inr';

/** Value label at the end of each diverging bar, placed outward of the bar end. */
function ChangeBarLabel({
  x,
  y,
  width,
  height,
  value,
  metric,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
  metric: ChangeMetric;
}) {
  if (x == null || y == null || width == null || height == null || value == null) return null;
  const positive = value >= 0;
  // For a diverging bar, `x` is the left edge and `width` the drawn length; the
  // outward end is x+width for a rightward (positive) bar, x for a leftward one.
  const tx = positive ? x + width + 6 : x - 6;
  const text = metric === 'pct' ? formatSignedPct(value) : formatSignedINR(value);
  return (
    <text
      x={tx}
      y={y + height / 2}
      dy={4}
      fontSize={11}
      fill={CHART_AXIS_LABEL}
      textAnchor={positive ? 'start' : 'end'}
    >
      {text}
    </text>
  );
}

/**
 * (c) Diverging "change over the range" bar chart — one horizontal bar per head,
 * extending right (green) for an increase and left (red) for a decrease, ranked
 * largest-increase-first. A "% | ₹" toggle switches the metric (default %); ₹
 * restores the rupee magnitude the old momentum view hid. Derived client-side
 * from the same per-head series; heads missing a first- or last-month value are
 * omitted (never computed off 0) and reported below the chart.
 */
export function HeadChangeChart({ data }: { data: HeadTrendPoint[] }) {
  const [metric, setMetric] = useState<ChangeMetric>('pct');
  const { firstMonth, lastMonth, changes, omitted } = deriveHeadChanges(data);

  // % mode can only plot heads with a non-null % (a ₹0 baseline has none); ₹ mode
  // plots every derived change. Sort largest-increase → largest-decrease.
  const noPctBaseline = metric === 'pct' ? changes.filter((c) => c.pctChange === null) : [];
  const usable = changes
    .filter((c) => (metric === 'pct' ? c.pctChange !== null : true))
    .map((c) => ({
      name: c.name,
      value: metric === 'pct' ? (c.pctChange as number) : c.absChange,
    }))
    .sort((a, b) => b.value - a.value);

  const toggle = (
    <div className="inline-flex" role="group" aria-label="Change metric">
      <Button
        type="button"
        size="sm"
        variant={metric === 'pct' ? 'default' : 'outline'}
        className="rounded-r-none"
        aria-pressed={metric === 'pct'}
        onClick={() => setMetric('pct')}
      >
        %
      </Button>
      <Button
        type="button"
        size="sm"
        variant={metric === 'inr' ? 'default' : 'outline'}
        className="-ml-px rounded-l-none"
        aria-pressed={metric === 'inr'}
        onClick={() => setMetric('inr')}
      >
        ₹
      </Button>
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        Change from {shortMonth(firstMonth)} to {shortMonth(lastMonth)} — increases right, decreases
        left, ranked by size.
      </p>
      {toggle}
    </div>
  );

  if (usable.length === 0) {
    return (
      <div className="space-y-2">
        {header}
        <Empty label="No head has a value in both the first and last month of this range." />
      </div>
    );
  }

  // Symmetric-ish domain that always includes 0 so the zero line sits inside.
  const values = usable.map((u) => u.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const spread = rawMax - rawMin;
  const step = niceStep(spread || 1);
  let domain: [number, number] = [
    Math.floor((rawMin - spread * 0.12) / step) * step,
    Math.ceil((rawMax + spread * 0.12) / step) * step,
  ];
  // All changes exactly 0 (e.g. a one-month range) would collapse to [0, 0].
  if (domain[0] === domain[1]) domain = [-step, step];
  const tickFmt = (v: number) => (metric === 'pct' ? `${v}%` : compactINR(v));

  return (
    <div className="space-y-2">
      {header}
      <div className="w-full" style={{ height: Math.max(160, usable.length * 38 + 48) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={usable} layout="vertical" margin={{ top: 8, right: 64, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridStroke} />
            <XAxis
              type="number"
              domain={domain}
              tickFormatter={tickFmt}
              fontSize={12}
              stroke={gridStroke}
              tick={axisTick}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              fontSize={12}
              stroke={gridStroke}
              tick={axisTick}
            />
            <Tooltip
              {...tooltipProps}
              formatter={(v: number | string) =>
                metric === 'pct' ? formatSignedPct(Number(v)) : formatSignedINR(Number(v))
              }
            />
            {/* Zero baseline. */}
            <ReferenceLine x={0} stroke={CHART_GRID} />
            <Bar dataKey="value" radius={2} isAnimationActive={false}>
              {usable.map((u) => (
                <Cell
                  key={u.name}
                  fill={u.value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE}
                  stroke={u.value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE}
                />
              ))}
              <LabelList dataKey="value" content={(p) => <ChangeBarLabel {...p} metric={metric} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(omitted.length > 0 || noPctBaseline.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {omitted.length > 0 &&
            `${omitted.length} head${omitted.length > 1 ? 's' : ''} hidden — no value in the first or last month of the range.`}
          {omitted.length > 0 && noPctBaseline.length > 0 && ' '}
          {noPctBaseline.length > 0 &&
            `${noPctBaseline.length} head${noPctBaseline.length > 1 ? 's' : ''} started at ₹0 — no % baseline; switch to ₹ to see ${noPctBaseline.length > 1 ? 'them' : 'it'}.`}
        </p>
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

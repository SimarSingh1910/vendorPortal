import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
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
  VarianceReport,
} from '@portal/shared';
import { formatINR } from '@/lib/format';
import { headSplitTotals } from '@/lib/headSplit';
import {
  buildHeadColorMap,
  headColor,
  CHART_ANCHOR,
  CHART_AXIS_LABEL,
  CHART_CAPTION,
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

/**
 * (b) Month-on-month total expense, as labelled bars. The current (last) month
 * is highlighted in the brand accent; the rest are the steel anchor. A dashed
 * line marks the range average.
 */
export function MonthlyTotalsChart({ data }: { data: MonthlyTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No expense data for the selected range." />;
  const rows = data.map((p) => ({ month: p.month, total: Number(p.total) }));
  const avg = rows.reduce((s, r) => s + r.total, 0) / rows.length;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 24, right: 56, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
          <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} stroke={gridStroke} tick={axisTick} />
          <YAxis tickFormatter={compactINR} fontSize={12} width={70} stroke={gridStroke} tick={axisTick} />
          <Tooltip
            {...tooltipProps}
            formatter={moneyTooltip}
            labelFormatter={(l) => shortMonth(String(l))}
          />
          {/* Range-average reference line. */}
          <ReferenceLine
            y={avg}
            strokeDasharray="5 4"
            stroke={CHART_AXIS_LABEL}
            strokeOpacity={0.7}
            label={{
              value: `avg ${compactINR(avg)}`,
              position: 'right',
              fontSize: 11,
              fill: CHART_AXIS_LABEL,
            }}
          />
          <Bar
            dataKey="total"
            name="Total"
            fill={CHART_ANCHOR}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="total"
              position="top"
              fontSize={10}
              fill={CHART_AXIS_LABEL}
              formatter={(v: number | string) => compactINR(Number(v))}
            />
          </Bar>
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
  // A single month in scope (e.g. the month picker narrowed to one) has no trend
  // to draw, so the momentum / rupee-line panel is dropped and the bars go full
  // width — the bars still read as that month's per-head comparison.
  const singleMonth = rows.length <= 1;
  const lineDomain = single
    ? fitLineDomain(rows.map((r) => Number(r[single.name])))
    : undefined;

  // All-heads line becomes a momentum view: rebase each head to 100 at its
  // first month so growth rates are comparable across very different sizes.
  const indexedRows = single ? [] : buildIndexedRows(rows, heads);
  const indexDomain = single ? undefined : fitIndexDomain(indexedRows, heads);

  return (
    <div className="space-y-4">
      {/* Shared head legend — both charts key colours by head id. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {heads.map((head) => (
          <span
            key={head.id}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: CHART_LEGEND_TEXT }}
          >
            <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: resolve(head.id) }} />
            {head.name}
          </span>
        ))}
      </div>

      <div className={singleMonth ? 'space-y-6' : 'grid gap-6 lg:grid-cols-2'}>
        {/* Left: monthly totals by head (grouped bars). */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Monthly totals by head</p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 20, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} stroke={gridStroke} tick={axisTick} />
                <YAxis tickFormatter={compactINR} fontSize={12} width={70} stroke={gridStroke} tick={axisTick} />
                <Tooltip
                  {...tooltipProps}
                  formatter={moneyTooltip}
                  labelFormatter={(l) => shortMonth(String(l))}
                />
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
        </div>

        {/* Right: momentum (all heads) or the single head's rupee trend —
            omitted entirely when only one month is in scope. */}
        {!singleMonth &&
          (single ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Monthly trend</p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} stroke={gridStroke} tick={axisTick} />
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
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Momentum (indexed to 100)</p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indexedRows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="month" tickFormatter={shortMonth} fontSize={12} stroke={gridStroke} tick={axisTick} />
                  <YAxis fontSize={12} width={70} domain={indexDomain} stroke={gridStroke} tick={axisTick} />
                  {/* The 100 baseline every head starts from. */}
                  <ReferenceLine y={100} stroke={CHART_AXIS_LABEL} strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Tooltip
                    {...tooltipProps}
                    formatter={indexTooltip}
                    labelFormatter={(l) => shortMonth(String(l))}
                  />
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
          ))}
      </div>
    </div>
  );
}

/**
 * Month-wise clinic report as per-head lines over the window (Step 4 panel chart
 * view).
 *
 * When `onHeadClick` is supplied each head in the legend becomes a button that jumps
 * to that head's block in the provision table on the same screen (see
 * lib/headHighlight) — a read-only navigation aid: it scrolls and highlights, and
 * changes neither the data nor this chart's own series. Without the prop the legend
 * is plain text, so the chart is unchanged wherever no table is there to jump to.
 * Colours stay keyed by head id either way.
 */
export function MonthwiseChart({
  report,
  onHeadClick,
}: {
  report: MonthwiseReport;
  onHeadClick?: (expenseHeadId: string) => void;
}) {
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
    <div className="space-y-3">
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
            {/* Recharts' own Legend is only rendered when the head names are NOT
                clickable; the clickable variant is real buttons below the plot, which
                the SVG legend can't give us (focus, hover, pointer cursor). */}
            {!onHeadClick && <Legend formatter={legendTextFormatter} />}
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
      {onHeadClick && (
        <HeadJumpLegend
          heads={report.rows.map((h) => ({ id: h.expenseHeadId, name: h.expenseHeadName }))}
          colorOf={(id) => headColor(colorMap, id)}
          onHeadClick={onHeadClick}
        />
      )}
    </div>
  );
}

/**
 * Legend whose entries jump to the matching G/L head in the table below — swatch +
 * head name, laid out exactly like the static head legends elsewhere so the chart
 * doesn't gain a second legend style. Real <button>s: they get a pointer cursor,
 * hover/focus affordance and keyboard access, and being buttons (not links) says
 * plainly that nothing navigates away and nothing is submitted.
 */
function HeadJumpLegend({
  heads,
  colorOf,
  onHeadClick,
}: {
  heads: Array<{ id: string; name: string }>;
  colorOf: (id: string) => string;
  onHeadClick: (expenseHeadId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {heads.map((head) => (
        <button
          key={head.id}
          type="button"
          onClick={() => onHeadClick(head.id)}
          title={`Go to ${head.name} in the table below`}
          className="flex cursor-pointer items-center gap-1.5 rounded text-xs hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{ color: CHART_LEGEND_TEXT }}
        >
          <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: colorOf(head.id) }} />
          {head.name}
        </button>
      ))}
    </div>
  );
}

/**
 * (d) Clinic-wise totals over the range: a ranked list of track bars with each
 * clinic's total and its share of the grand total. The largest clinic is
 * highlighted in the brand accent; the bar length is relative to the top clinic.
 */
export function ClinicTotalsChart({ data }: { data: ClinicTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No clinic totals for the selected range." />;
  const rows = data
    .map((c) => ({ name: c.clinicName, total: Number(c.total) }))
    .sort((a, b) => b.total - a.total);
  const grand = rows.reduce((s, r) => s + r.total, 0);
  const max = rows[0]?.total || 1;
  return (
    // Scrolled inside a fixed cap, because one row per clinic grows without limit —
    // at 43 clinics this list was ~1200px tall and pushed the whole dashboard down.
    //
    // The cap is 24rem, NOT the h-72 (18rem) the donut beside it uses: that card is
    // the donut PLUS its wrapped expense-head legend, so 18rem left this one visibly
    // short of it. 24rem ≈ the 18rem donut + its 1rem gap + ~3 legend rows, which
    // lines the two cards up. `max-h` rather than a fixed height so a SPOC with two
    // clinics gets a two-row card instead of 24rem of whitespace. `pr-1` keeps the
    // scrollbar off the bars.
    <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3 text-sm">
          {/* Fixed-width label column, so a long clinic name always clips — the
              tooltip is the only way back to the full name. */}
          <span
            className="w-36 shrink-0 truncate text-right text-muted-foreground"
            title={r.name}
          >
            {r.name}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded"
              style={{
                width: `${max > 0 ? (r.total / max) * 100 : 0}%`,
                backgroundColor: CHART_ANCHOR,
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right font-mono tabular-nums">{compactINR(r.total)}</span>
          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
            {grand > 0 ? `${((r.total / grand) * 100).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Percentage share drawn in the middle of each donut band. Recharts hands the
 * label renderer loosely-typed geometry, so coerce to numbers; thin slivers are
 * left unlabelled (the tooltip still carries their exact figure).
 */
function PieShareLabel(props: {
  cx?: number | string;
  cy?: number | string;
  midAngle?: number | string;
  innerRadius?: number | string;
  outerRadius?: number | string;
  percent?: number | string;
}) {
  const cx = Number(props.cx);
  const cy = Number(props.cy);
  const midAngle = Number(props.midAngle);
  const innerR = Number(props.innerRadius);
  const outerR = Number(props.outerRadius);
  const percent = Number(props.percent);
  if (![cx, cy, midAngle, innerR, outerR, percent].every(Number.isFinite)) return null;
  if (percent < 0.03) return null; // too thin to label legibly
  const RAD = Math.PI / 180;
  const r = innerR + (outerR - innerR) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text
      x={x}
      y={y}
      fill={CHART_TOOLTIP_TEXT}
      fontSize={11}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

/**
 * Expense-head split: a donut of each head's share of total provision over the
 * range. Slices are ranked largest → smallest and coloured by the id-keyed head
 * palette (same head = same colour as in every other chart — this chart uses the
 * id palette, NOT direction coding). The percentage share sits on each slice; the
 * tooltip carries the head name, its ₹ amount and %; the legend lists heads with
 * their swatch and neutral text; the donut centre shows the range total. Heads
 * with no data contribute no slice (NULL ≠ 0). With one head selected it is a
 * single 100% slice.
 */
export function ExpenseHeadPieChart({
  data,
  colorOf,
}: {
  data: HeadTrendPoint[];
  colorOf?: (id: string) => string;
}) {
  const slices = headSplitTotals(data);
  if (slices.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const grand = slices.reduce((s, r) => s + r.total, 0);
  const localMap = buildHeadColorMap(slices);
  const resolve = colorOf ?? ((id: string) => headColor(localMap, id));

  return (
    <div className="space-y-4">
      <div className="relative h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="total"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="82%"
              paddingAngle={1}
              stroke="#FFFFFF"
              strokeWidth={2}
              isAnimationActive={false}
              labelLine={false}
              label={PieShareLabel}
            >
              {slices.map((s) => (
                <Cell key={s.id} fill={resolve(s.id)} />
              ))}
            </Pie>
            <Tooltip
              {...tooltipProps}
              formatter={(value, _name, item) => {
                const v = Number(value);
                const pct = grand > 0 ? ((v / grand) * 100).toFixed(1) : '0.0';
                const nm = (item as { payload?: { name?: string } })?.payload?.name ?? '';
                return [`${formatINR(v)}  ·  ${pct}%`, nm];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Donut centre: the range total across the heads drawn. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs" style={{ color: CHART_CAPTION }}>
            Total
          </span>
          <span className="font-mono text-sm tabular-nums" style={{ color: CHART_TOOLTIP_TEXT }}>
            {compactINR(grand)}
          </span>
        </div>
      </div>
      {/* Legend — swatch + neutral head name, matching the head-trend legend. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {slices.map((s) => (
          <span
            key={s.id}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: CHART_LEGEND_TEXT }}
          >
            <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: resolve(s.id) }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Signed Δ% label at the outward end of a diverging variance bar. Recharts hands
 * the content renderer loosely-typed geometry props, so coerce to numbers.
 */
function DivergingPctLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}) {
  const x = Number(props.x);
  const y = Number(props.y);
  const width = Number(props.width);
  const height = Number(props.height);
  const value = Number(props.value);
  if (![x, y, width, height, value].every(Number.isFinite)) return null;
  const positive = value >= 0;
  const tx = positive ? x + width + 6 : x - 6;
  return (
    <text
      x={tx}
      y={y + height / 2}
      dy={4}
      fontSize={11}
      fill={CHART_AXIS_LABEL}
      textAnchor={positive ? 'start' : 'end'}
    >
      {`${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`}
    </text>
  );
}

/** Variance bar colours — the steel anchor by default, switching to a muted rose
 *  for heads whose deviation breaches the ±threshold (a "high deviation" in either
 *  direction). This chart is NOT the id-keyed head palette. */
const VARIANCE_NEUTRAL = '#5A7C9C';
const VARIANCE_FLAGGED = '#D9636F';

/**
 * Greedily wrap a category label to at most two lines so long head names
 * ("Credit Card Machine Hire Charges") render in the left gutter without truncation
 * or overlap. Anything past two lines stays on the second line rather than being cut.
 */
function wrapCategory(label: string, maxChars = 18): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [label];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line && lines.length === 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

/** Two-line-capable category tick for the variance axis, vertically centred on its bar. */
function VarianceCategoryTick(props: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string | number };
}) {
  const x = Number(props.x);
  const y = Number(props.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return <g />;
  const full = String(props.payload?.value ?? '');
  const lines = wrapCategory(full);
  const startDy = lines.length > 1 ? -1 : 4;
  return (
    <text x={x} y={y} textAnchor="end" fontSize={12} fill={CHART_AXIS_LABEL}>
      {/* wrapCategory caps at two lines, so a long head name loses its tail with no
          ellipsis to hint at it. SVG's own <title> is the tooltip equivalent of the
          `title` attribute used on the HTML labels elsewhere. */}
      <title>{full}</title>
      {lines.map((ln, i) => (
        <tspan key={ln} x={x} dy={i === 0 ? startDy : 12}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}

/**
 * (e) Variance vs prior month: a diverging Δ% bar per head, ranked. Bars are a
 * neutral grey, turning muted rose (#D9636F) for heads that breach the ±threshold
 * — a high deviation in EITHER direction (this chart is the intentional exception
 * to the id-keyed head palette). A shaded band marks the ±threshold zone. Heads
 * with no prior baseline (null Δ%) are omitted rather than drawn off an implied 0
 * (NULL ≠ 0), and listed below. Spans the full content width, so the plot area is
 * wide enough for every bar and the axis with no horizontal scroll.
 */
export function VarianceDivergingChart({ report }: { report: VarianceReport }) {
  const threshold = report.thresholdPercent != null ? Number(report.thresholdPercent) : null;
  const rows = report.rows
    .filter((r) => r.deviationPercent != null)
    .map((r) => ({ name: r.expenseHeadName, value: Number(r.deviationPercent), flagged: r.flagged }))
    .sort((a, b) => b.value - a.value);
  const omitted = report.rows.filter((r) => r.deviationPercent == null);

  if (rows.length === 0) {
    return <Empty label="No head has a prior-month baseline to compare against." />;
  }

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), threshold ?? 0, 1);
  const bound = Math.ceil((maxAbs * 1.15) / 5) * 5;
  const domain: [number, number] = [-bound, bound];

  return (
    <div className="space-y-2">
      <div className="w-full" style={{ height: Math.max(160, rows.length * 38 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 56, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridStroke} />
            <XAxis
              type="number"
              domain={domain}
              tickFormatter={(v: number) => `${v}%`}
              fontSize={12}
              stroke={gridStroke}
              tick={axisTick}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              interval={0}
              stroke={gridStroke}
              tick={VarianceCategoryTick}
            />
            {/* ±threshold band. */}
            {threshold != null && (
              <ReferenceArea x1={-threshold} x2={threshold} fill={CHART_AXIS_LABEL} fillOpacity={0.07} />
            )}
            <ReferenceLine x={0} stroke={CHART_GRID} />
            <Tooltip
              {...tooltipProps}
              formatter={(v: number | string) =>
                `${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(1)}%`
              }
            />
            <Bar dataKey="value" radius={2} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.name} fill={r.flagged ? VARIANCE_FLAGGED : VARIANCE_NEUTRAL} />
              ))}
              <LabelList dataKey="value" content={(p) => <DivergingPctLabel {...p} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {omitted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No prior baseline: {omitted.map((o) => o.expenseHeadName).join(', ')}.
        </p>
      )}
    </div>
  );
}

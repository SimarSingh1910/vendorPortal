/**
 * Single source of truth for chart colours across the app.
 *
 * Heads are coloured DETERMINISTICALLY: the in-scope heads are ordered by name
 * and assigned palette colours in that order, so (a) the same head is the same
 * colour in every chart (trend, month-wise, …) and (b) a newly-added head gets a
 * stable colour from its place in that order. Build the map ONCE from the full
 * head set (the dashboard filter options) and look up by head id — never from a
 * per-chart subset, so a chart filtered to a single head keeps that head's colour.
 */

/**
 * Chart chrome colours, aligned to the HCL brand tokens: hairline grid
 * (#E3E8F0 border), axis lines / ticks / labels in muted-foreground (#47505C),
 * axis captions in the lighter placeholder grey (#7A8595). Legend text stays
 * neutral (#47505C) — the swatch carries the series colour. Tooltip is a white
 * hairline-bordered card with near-black (#212529) text.
 */
export const CHART_GRID = '#E3E8F0';
export const CHART_AXIS_LABEL = '#47505C';
export const CHART_CAPTION = '#7A8595';
export const CHART_LEGEND_TEXT = '#47505C';
export const CHART_TOOLTIP_TEXT = '#212529';

/** Recharts Tooltip `contentStyle`: white surface, hairline border, soft shadow. */
export const CHART_TOOLTIP_STYLE = {
  background: '#FFFFFF',
  border: `1px solid ${CHART_GRID}`,
  borderRadius: '0.5rem',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
  color: CHART_TOOLTIP_TEXT,
} as const;

/**
 * On-theme categorical series palette (soft, chalky, low-saturation — steel blue,
 * amber, pale aqua, coral … extended in the same key). These sit on white cards,
 * so the charts read a touch lighter than the navy shell, which is intended.
 * Ordered for maximum separation — assigned by slot in `buildHeadColorMap` and
 * keyed by head id, so a given head keeps its colour in every chart / month /
 * filter. Cycles past slot 10; never random.
 */
export const CHART_PALETTE = [
  '#5A7C9C', // steel blue (anchor)
  '#FBC04A', // amber
  '#B6E3DD', // pale aqua
  '#F19FAD', // coral pink
  '#C8B6E2', // lavender
  '#A8C99A', // sage
  '#F5C9A0', // peach
  '#8FB3C9', // sky blue
  '#F9CFD7', // pale pink
  '#D4C5A9', // sand
] as const;

/** The anchor steel-blue — used for single-series charts (§3). */
export const CHART_ANCHOR = CHART_PALETTE[0];
/** One step deeper than the anchor — optional single-series bar hover (§3). */
export const CHART_ANCHOR_HOVER = '#4A6A88';

/** Palette colour for a 0-based index, cycling when there are more heads than colours. */
export function colorByIndex(i: number): string {
  const n = CHART_PALETTE.length;
  return CHART_PALETTE[((i % n) + n) % n];
}

/** Small stable string hash (djb2) — deterministic fallback for unknown ids. */
function hashIndex(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) h = (h * 33 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Build a stable expenseHeadId → colour map. Heads are sorted by name (id as a
 * tiebreak) and assigned palette colours in that order. The seeded heads thus
 * reproduce the reference mapping (alphabetical = palette order).
 */
export function buildHeadColorMap(
  heads: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string> {
  const ordered = [...heads].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((h, i) => [h.id, colorByIndex(i)]));
}

/** Look up a head's colour, falling back to a stable hash-based palette slot. */
export function headColor(map: Map<string, string>, id: string): string {
  return map.get(id) ?? colorByIndex(hashIndex(id));
}

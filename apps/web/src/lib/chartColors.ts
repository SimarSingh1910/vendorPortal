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

/** Refined, reasonably colour-blind-friendly palette (ordered). */
export const CHART_PALETTE = [
  '#3B5BDB',
  '#2F9E44',
  '#E03131',
  '#F08C00',
  '#7048E8',
  '#1098AD',
  '#D6336C',
  '#9C6B3F',
] as const;

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

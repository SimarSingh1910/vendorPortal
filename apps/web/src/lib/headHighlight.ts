import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Jump-to-a-G/L-head navigation, in BOTH directions on the provision screens
 * (read-only).
 *
 * A screen shows the same expense heads twice: the provision table being filled or
 * reviewed, and the month-wise trend report beneath it. Either one can send the
 * reader to the other:
 *
 *   • chart legend  → the head's block in the PROVISION table   (anchor: headAnchorId)
 *   • G/L no./name  → the head's row in the TREND table below   (anchor: reportHeadAnchorId)
 *
 * The second is what makes "is this month's figure sane?" a single click: from the
 * line being typed or reviewed straight to that head's history, without hunting for
 * the row. It is on EVERY provision screen — SPOC entry, clinic-manager review and
 * finance review — because every one of those readers checks a figure against its
 * trend.
 *
 * It is deliberately navigation-only. Nothing here selects, filters, mutates or
 * persists anything — no request is made and no audit row is written; the reader
 * simply ends up looking at a row they were already allowed to see.
 *
 * Keyed by EXPENSE HEAD ID, the same id that keys the chart colour palette (see
 * lib/chartColors), so a head's colour, its click targets and its anchors all agree
 * without a second identifier.
 */

/** The DOM id of a G/L head's block in a PROVISION table (entry / review). */
export function headAnchorId(expenseHeadId: string): string {
  return `gl-head-${expenseHeadId}`;
}

/** The DOM id of a G/L head's row in the MONTH-WISE TREND table below it. */
export function reportHeadAnchorId(expenseHeadId: string): string {
  return `gl-trend-${expenseHeadId}`;
}

/**
 * Highlight styling for the rows of the targeted head's block. A brief soft-blue
 * tint that fades out on its own (rather than a sticky "selected" outline), because
 * the highlight answers a momentary "where is it?" — leaving it on would read as a
 * persistent selection the table doesn't actually have.
 *
 * The tint is the theme's soft blue and the left accent is the brand blue already
 * used for the entry screen's attention accent. `transition-colors` on the shared
 * TableRow does the fade for us when the class is dropped.
 */
export const HEAD_HIGHLIGHT_ROW = 'bg-[#EAF2FB] duration-700';

/**
 * The left accent, applied to the FIRST cell of each highlighted row. An inset
 * box-shadow rather than a border: the provision tables render with collapsed
 * borders, where a `border-left` on a <tr> is not painted at all.
 */
export const HEAD_HIGHLIGHT_CELL = 'shadow-[inset_4px_0_0_0_#4579B3]';

/**
 * Affordance for a clickable G/L head — the account number and name in the
 * provision table. Underline on HOVER only: every head row carries one, and
 * permanently underlining them all would read as a table full of links.
 */
export const HEAD_JUMP_BUTTON =
  'cursor-pointer rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** How long the highlight stays before fading out. */
const HIGHLIGHT_MS = 2000;

/**
 * Scroll a head's anchor into view and highlight it for ~2s.
 *
 * `anchorIdFor` picks WHICH of the two tables this instance drives, so one screen
 * can run two independent instances (chart→provision and provision→trends) without
 * them fighting over a single highlight.
 *
 * The scroll runs in an EFFECT rather than inside the click handler, because the
 * target may not be in the DOM at click time — the trend panel can be showing its
 * chart, and only flips to the table in the same render this state change triggers.
 * By the time effects run, that row has been committed. `highlightNonce` is what
 * makes a REPEAT click on the already-highlighted head re-scroll and restart the
 * fade: the id alone wouldn't change, so the effect would never re-run.
 */
export function useHeadHighlight(anchorIdFor: (id: string) => string = headAnchorId): {
  highlightedHeadId: string | null;
  highlightNonce: number;
  highlightHead: (expenseHeadId: string) => void;
} {
  const [highlightedHeadId, setHighlightedHeadId] = useState<string | null>(null);
  const [highlightNonce, setHighlightNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the scroll effect without making it a dependency — a new resolver
  // identity must not re-fire a scroll the reader never asked for.
  const resolver = useRef(anchorIdFor);
  resolver.current = anchorIdFor;

  // Don't leave a timer running into an unmount (it would set state on a gone tree).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!highlightedHeadId) return;
    document
      .getElementById(resolver.current(highlightedHeadId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedHeadId, highlightNonce]);

  const highlightHead = useCallback((expenseHeadId: string) => {
    // Re-clicking the same head restarts the fade rather than doing nothing.
    if (timer.current) clearTimeout(timer.current);
    setHighlightedHeadId(expenseHeadId);
    setHighlightNonce((n) => n + 1);
    timer.current = setTimeout(() => setHighlightedHeadId(null), HIGHLIGHT_MS);
  }, []);

  return { highlightedHeadId, highlightNonce, highlightHead };
}

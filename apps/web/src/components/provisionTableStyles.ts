/**
 * Shared visual language for the nested provision table (head → vendor line →
 * particulars), used by the SPOC entry screen and both clinic review screens.
 *
 * The markup for that table is currently duplicated across those three pages.
 * Rather than restructure them (which would be a behavioural risk for a purely
 * cosmetic change), the CLASSES live here so the three stay in step: change a
 * weight or a rule once, and every view follows.
 *
 * TWO BORDER WEIGHTS, TWO MEANINGS — this is the whole point:
 *   • `border-strong` (#CBD5E1, 2px) separates one G/L HEAD from the next.
 *   • `border` (#E3E8F0, 1px hairline) separates rows INSIDE a head.
 * A reader scanning the table can tell a head boundary from an internal one
 * without reading any text.
 */

/**
 * First row of a head — the heavy rule that says "a new G/L account starts here".
 * `border-b-0` suppresses the table primitive's default hairline so the only
 * lines inside a head are the ones placed deliberately below.
 */
export const HEAD_ROW = 'border-t-2 border-t-border-strong border-b-0';

/** A subsequent vendor line within the SAME head — a light internal hairline. */
export const VENDOR_ROW = 'border-t border-t-border border-b-0';

/**
 * The particulars sub-table's row. No top rule at all: the particulars belong to
 * the vendor line directly above them, so a line between the two would wrongly
 * imply a break. The sub-table draws its own internal hairlines.
 */
export const PARTICULARS_ROW = 'border-b-0 hover:bg-transparent';

/** The "+ Add vendor row" control row — inert, no rules. */
export const ADD_ROW = 'border-b-0';

/**
 * "Total — <head>" closing row: a hairline above it so it reads as the summary
 * line of the block it closes, immediately before the next head's heavy rule.
 */
export const TOTAL_ROW = 'border-t border-t-border border-b-0 hover:bg-transparent';

/**
 * The head's G/L No. / Name. Deliberately heavier than everything nested beneath
 * it — `text-foreground` is the app's heading colour, so a head row matches every
 * other heading rather than introducing a second near-black.
 */
export const HEAD_TEXT = 'font-semibold text-foreground';

/** The head's roll-up figure (on the Total row, or on the only line of a head). */
export const HEAD_AMOUNT = 'font-semibold tabular-nums';

/** A vendor line's own subtotal — present, but subordinate to the head figure. */
export const LINE_AMOUNT = 'font-medium tabular-nums';

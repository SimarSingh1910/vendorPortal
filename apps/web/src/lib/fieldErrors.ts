/**
 * Styling + id helpers for the provision form's inline required-field markers.
 *
 * Kept out of the component file so the component module exports only a component
 * (fast-refresh keeps working, and the constants can be imported from non-component
 * modules without pulling JSX in).
 *
 * Reuses the theme's existing error tokens rather than introducing a new red:
 * `--destructive` (#BA1A1A) for the border, the same token behind the
 * `text-destructive` helper text already used by the admin forms.
 */

/** Border + focus ring for an input whose required value is missing. */
export const INVALID_FIELD_CLASS = 'border-destructive focus-visible:ring-destructive';

/** The id of the message node describing a field — kept in one place. */
export function fieldErrorTextId(fieldId: string): string {
  return `${fieldId}-error`;
}

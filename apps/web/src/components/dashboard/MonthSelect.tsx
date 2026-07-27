import { formatMonth } from '@/lib/format';

/**
 * Compact month picker shown in a card's control row (next to the chart/table
 * toggle). The empty value is "Whole range" — the canonical "no single-month
 * focus". Sized to line up with the head multi-select and the view toggle.
 */
export function MonthSelect({
  value,
  options,
  onChange,
}: {
  /** Selected 'YYYY-MM'; empty string = whole range. */
  value: string;
  /** Selectable months (newest first), whole range is always prepended. */
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label="Focus month"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">Whole range</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}

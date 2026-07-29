import { MultiSelect } from './MultiSelect';

interface Head {
  id: string;
  name: string;
}

/**
 * Multi-select expense-head filter (checkbox list) for the head-trend / split
 * blocks. A thin wrapper over the shared {@link MultiSelect}: it keeps the head
 * filter's tri-state behaviour (`null` = All heads, empty Set = none → the charts
 * render an empty state, otherwise a subset) via `allowEmpty`, so subsetting and
 * the empty-view case are unchanged.
 */
export function HeadMultiSelect({
  heads,
  selected,
  onChange,
}: {
  heads: Head[];
  /** `null` = All heads; empty Set = none; otherwise the chosen subset. */
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  return (
    <MultiSelect
      items={heads}
      selected={selected}
      onChange={onChange}
      nounSingular="head"
      nounPlural="heads"
      allowEmpty
      ariaLabel="Filter by expense head"
    />
  );
}

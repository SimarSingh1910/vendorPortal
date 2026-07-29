import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Item<T extends string> {
  id: T;
  name: string;
}

/**
 * Generic multi-select (checkbox list) filter — the shared implementation behind
 * the dashboard's expense-head, clinic, SPOC and status filters. Selection is
 * tri-state:
 *   • `null`        → "All …" (the default; async-safe since it needs no ids)
 *   • empty `Set`   → NONE selected (only reachable when `allowEmpty`)
 *   • partial `Set` → just that subset
 * The header "All …" checkbox is a select-all toggle; it shows an indeterminate
 * dash while a partial subset is chosen. Selecting every option individually
 * collapses back to `null` ("all").
 *
 * `allowEmpty` decides what unticking the last option does:
 *   • `false` (default) → falls back to "All" (`null`); an empty result is never
 *     allowed, so the header checkbox is a pure "reset to all".
 *   • `true`  → an empty `Set` ("none") is a valid state that is passed through
 *     (the expense-head filter uses this to render an empty chart).
 *
 * Built from native inputs (tinted with the brand accent) to match the app's
 * other native filter controls — no dropdown library is pulled in.
 */
export function MultiSelect<T extends string>({
  items,
  selected,
  onChange,
  nounSingular,
  nounPlural,
  allowEmpty = false,
  ariaLabel,
  fullWidth = false,
}: {
  items: Item<T>[];
  /** `null` = All; empty Set = none (only with `allowEmpty`); otherwise the subset. */
  selected: Set<T> | null;
  onChange: (next: Set<T> | null) => void;
  /** Noun for the trigger label, e.g. "clinic" / "clinics". */
  nounSingular: string;
  nounPlural: string;
  allowEmpty?: boolean;
  ariaLabel: string;
  /** Stretch the trigger to fill its grid cell (filter bar) vs. a compact inline control. */
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // `null`, or (defensively) an explicit full set, both read as "all".
  const allSelected = selected === null || (items.length > 0 && selected.size === items.length);
  const noneSelected = selected !== null && selected.size === 0;
  // Header checkbox shows a dash while a partial subset is chosen.
  const partial = !allSelected && !noneSelected;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = partial;
  }, [partial, open]);

  const label = allSelected
    ? `All ${nounPlural}`
    : noneSelected
      ? `No ${nounPlural} selected`
      : selected!.size === 1
        ? (items.find((i) => selected!.has(i.id))?.name ?? `1 ${nounSingular} selected`)
        : `${selected!.size} ${nounPlural} selected`;

  // A row is ticked when "all" is active or it's in the chosen subset.
  const isChecked = (id: T) => selected === null || selected.has(id);

  const toggle = (id: T) => {
    // From "all", start with the full set so unticking one leaves the rest.
    const base = selected === null ? new Set(items.map((i) => i.id)) : new Set(selected);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    // A full set collapses back to the canonical "all" (`null`). An empty set is
    // a valid "none" only when allowed; otherwise it falls back to "all" so the
    // filter never yields an empty result.
    if (base.size === items.length) return onChange(null);
    if (base.size === 0 && !allowEmpty) return onChange(null);
    onChange(base);
  };

  // Header toggle: with allowEmpty it's a select-all / deselect-all (all ↔ none);
  // without, it's a pure "reset to all" (never empty).
  const onAllToggle = () => onChange(allowEmpty && allSelected ? new Set<T>() : null);

  return (
    <div ref={ref} className={cn('relative', fullWidth && 'w-full')}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          fullWidth ? 'h-9 w-full' : 'h-8 min-w-[10rem]',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className={cn(
            'absolute z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-input bg-popover p-1 text-sm text-popover-foreground shadow-md',
            fullWidth ? 'left-0 w-full min-w-[12rem]' : 'right-0 w-64',
          )}
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
            <input
              ref={allRef}
              type="checkbox"
              className="size-4 accent-primary"
              checked={allSelected}
              onChange={onAllToggle}
            />
            <span className="font-medium">All {nounPlural}</span>
          </label>
          <div className="my-1 h-px bg-border" />
          {items.map((i) => (
            <label
              key={i.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={isChecked(i.id)}
                onChange={() => toggle(i.id)}
              />
              <span className="truncate">{i.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

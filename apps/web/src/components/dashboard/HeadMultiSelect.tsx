import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Head {
  id: string;
  name: string;
}

/**
 * Multi-select expense-head filter (checkbox list) for the head-trend / split
 * blocks. Selection is tri-state:
 *   • `null`        → "All heads" (the default; async-safe since it needs no ids)
 *   • empty `Set`   → NONE selected (the charts render an empty state)
 *   • partial `Set` → just that subset
 * The header "All heads" checkbox is a proper select-all / deselect-all toggle:
 * ticking it selects all (`null`), unticking it deselects all (empty set). It
 * shows an indeterminate dash while a partial subset is chosen. Selecting every
 * head individually collapses back to `null` ("all").
 *
 * Built from native inputs (tinted with the brand accent) to match the app's
 * other native filter controls — no dropdown library is pulled in.
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
  const allSelected = selected === null || (heads.length > 0 && selected.size === heads.length);
  const noneSelected = selected !== null && selected.size === 0;
  // Header checkbox shows a dash while a partial subset is chosen.
  const partial = !allSelected && !noneSelected;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = partial;
  }, [partial, open]);

  const label = allSelected
    ? 'All heads'
    : noneSelected
      ? 'No heads selected'
      : selected!.size === 1
        ? (heads.find((h) => selected!.has(h.id))?.name ?? '1 head selected')
        : `${selected!.size} heads selected`;

  // A row is ticked when "all" is active or it's in the chosen subset.
  const isChecked = (id: string) => selected === null || selected.has(id);

  const toggle = (id: string) => {
    // From "all", start with the full set so unticking one leaves the rest.
    const base = selected === null ? new Set(heads.map((h) => h.id)) : new Set(selected);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    // A full set collapses back to the canonical "all" (`null`); an empty set is
    // now a valid "none" state, so it is passed through as-is.
    onChange(base.size === heads.length ? null : base);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by expense head"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 min-w-[10rem] items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-input bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
            <input
              ref={allRef}
              type="checkbox"
              className="size-4 accent-primary"
              checked={allSelected}
              // Select-all / deselect-all toggle: tick → all (`null`),
              // untick → none (empty set). From a partial subset, tick → all.
              onChange={() => onChange(allSelected ? new Set() : null)}
            />
            <span className="font-medium">All heads</span>
          </label>
          <div className="my-1 h-px bg-border" />
          {heads.map((h) => (
            <label
              key={h.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
            >
              <input
                type="checkbox"
                className={cn('size-4 accent-primary')}
                checked={isChecked(h.id)}
                onChange={() => toggle(h.id)}
              />
              <span className="truncate">{h.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

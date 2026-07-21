import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Head {
  id: string;
  name: string;
}

/**
 * Multi-select expense-head filter (checkbox list) for the head-trend block.
 * "All heads" is the empty selection — the canonical representation of "no
 * subset filter" — so a caller treats `selected.size === 0` as all. Selecting
 * every head individually collapses back to that empty "all" set, and unchecking
 * the last head falls back to all too, so the charts are never rendered empty.
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
  /** Selected head ids; an EMPTY set means "All heads". */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  // "All" when nothing (or, defensively, everything) is selected.
  const allSelected = selected.size === 0 || selected.size === heads.length;
  const label = allSelected
    ? 'All heads'
    : selected.size === 1
      ? (heads.find((h) => selected.has(h.id))?.name ?? '1 head selected')
      : `${selected.size} heads selected`;

  // A row is ticked when it's in the subset, or when "all" is active.
  const isChecked = (id: string) => allSelected || selected.has(id);

  const toggle = (id: string) => {
    // From "all", start with the full set so unticking one leaves the rest.
    const base = selected.size === 0 ? new Set(heads.map((h) => h.id)) : new Set(selected);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    // Empty is not allowed, and a full set is just "all" — both collapse to the
    // empty "all" set so the charts always have something to render.
    onChange(base.size === 0 || base.size === heads.length ? new Set() : base);
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
              type="checkbox"
              className="size-4 accent-primary"
              checked={allSelected}
              // Reset to "all" (empty set). When already all this is a no-op —
              // deselecting everything is not an allowed state.
              onChange={() => onChange(new Set())}
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

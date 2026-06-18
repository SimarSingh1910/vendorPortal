import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Reusable "action needed" emphasis (Iteration 2 / Step 6) — PRESENTATION ONLY.
 *
 * Accessibility (required by the step):
 *  - never colour-only: every cue is paired with the literal text "Action needed"
 *    (or a "Pending: N" count), and a shape (alert icon);
 *  - the static amber accent + text is sufficient on its own;
 *  - motion is gentle (a ~1 Hz dot, never a strobe) and applied ONLY via the
 *    `motion-safe:` variant, so users with prefers-reduced-motion see no motion.
 */

/**
 * Class for a pending row / card: a strong amber left accent + faint tint.
 * Static — safe to apply unconditionally on the element you want emphasised.
 */
export const attentionAccentClass = 'border-l-4 border-l-amber-500 bg-amber-50/70';

/** A small amber status dot that gently pulses only when motion is allowed. */
function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex size-2 shrink-0', className)} aria-hidden>
      <span className="absolute inline-flex size-full rounded-full bg-amber-500 opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-amber-600" />
    </span>
  );
}

/**
 * Inline "Action needed" chip. Colour + icon + text together, so it reads even
 * without colour. Use next to a status badge or in an action cell.
 */
export function ActionNeededBadge({
  label = 'Action needed',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900',
        className,
      )}
    >
      <PulseDot />
      <CircleAlert className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** Count pill for a nav item / section header, e.g. "Pending: 3". Null when 0. */
export function PendingCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white',
        className,
      )}
    >
      <PulseDot className="[&_*]:bg-white" />
      Pending: {count}
    </span>
  );
}

/** Short attention banner summarising pending work at the top of a screen. */
export function AttentionBanner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900',
        className,
      )}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * The short red message under a required field the SPOC hasn't filled in.
 *
 * Renders nothing when `message` is undefined, so callers can drop it in
 * unconditionally rather than wrapping every field in a conditional.
 *
 * `role="alert"` announces it to a screen reader the moment it appears; the field
 * itself carries `aria-invalid` and points here via `aria-describedby`.
 *
 * Only ever shown AFTER a blocked submit — a half-typed draft shouldn't look like a
 * page full of mistakes while it is still being filled in. The border styling that
 * goes with it lives in lib/fieldErrors.
 */
export function FieldErrorText({
  id,
  message,
  className,
}: {
  id: string;
  message?: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={cn('mt-1 text-xs text-destructive', className)}>
      {message}
    </p>
  );
}

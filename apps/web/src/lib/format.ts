import { SubmissionStatus, SUBMISSION_STATUS_LABELS } from '@portal/shared';
import type { BadgeProps } from '@/components/ui/badge';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format an INR amount (string from the API, or number) as ₹1,23,456.00. */
export function formatINR(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return Number.isNaN(n) ? '—' : inr.format(n);
}

/** 'YYYY-MM' → 'July 2026'. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Render a stored UTC instant in IST (the business timezone). */
export function formatIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export const statusLabel = (status: SubmissionStatus): string => SUBMISSION_STATUS_LABELS[status];

/** Map a submission status to a Badge variant for consistent colouring. */
export function statusBadgeVariant(status: SubmissionStatus): BadgeProps['variant'] {
  switch (status) {
    case SubmissionStatus.FINANCE_APPROVED:
      return 'success';
    case SubmissionStatus.SENT_BACK_BY_MANAGER:
    case SubmissionStatus.SENT_BACK_BY_FINANCE:
      return 'secondary';
    case SubmissionStatus.NOT_STARTED:
      return 'muted';
    default:
      return 'default';
  }
}

import { CorpDepartmentType, CorpSubmissionStatus } from '@portal/shared';
import type { BadgeProps } from '@/components/ui/badge';

/** Human labels for the corporate department classification (no shared map exists). */
export const DEPT_TYPE_LABELS: Record<CorpDepartmentType, string> = {
  [CorpDepartmentType.STANDARD]: 'Standard',
  [CorpDepartmentType.INTERNAL_BU]: 'Internal BU',
  [CorpDepartmentType.SHARED_COST_POOL]: 'Shared cost pool (Sec 24)',
};

/**
 * Corporate-side presentation helpers. The corporate workflow has its own
 * two-level lifecycle (CorpSubmissionStatus), so it needs its own labels, badge
 * colours and "action needed" predicates — the clinic `format.ts` ones are bound
 * to the clinic SubmissionStatus enum and don't cover these values.
 */

const CORP_STATUS_LABELS: Record<CorpSubmissionStatus, string> = {
  [CorpSubmissionStatus.NOT_STARTED]: 'Not started',
  [CorpSubmissionStatus.DRAFT]: 'Draft',
  [CorpSubmissionStatus.SUBMITTED]: 'Submitted',
  [CorpSubmissionStatus.FINANCE_MANAGER_REVIEW]: 'In finance review',
  [CorpSubmissionStatus.FINANCE_APPROVED]: 'Approved & locked',
  [CorpSubmissionStatus.SENT_BACK_TO_SPOC]: 'Sent back',
};

export const corpStatusLabel = (status: CorpSubmissionStatus): string =>
  CORP_STATUS_LABELS[status] ?? status;

/** Map a corporate submission status to a Badge variant for consistent colouring. */
export function corpStatusBadgeVariant(status: CorpSubmissionStatus): BadgeProps['variant'] {
  switch (status) {
    case CorpSubmissionStatus.FINANCE_APPROVED:
      return 'success';
    case CorpSubmissionStatus.SENT_BACK_TO_SPOC:
      return 'secondary';
    case CorpSubmissionStatus.NOT_STARTED:
      return 'muted';
    default:
      return 'default';
  }
}

/** The Dept SPOC owes action: nothing entered/submitted yet, or it was sent back. */
export function isCorpSpocActionPending(status: CorpSubmissionStatus): boolean {
  return (
    status === CorpSubmissionStatus.NOT_STARTED ||
    status === CorpSubmissionStatus.DRAFT ||
    status === CorpSubmissionStatus.SENT_BACK_TO_SPOC
  );
}

/** A corporate approver owes action: it's submitted or sitting in their review. */
export function isCorpApproverActionPending(status: CorpSubmissionStatus): boolean {
  return (
    status === CorpSubmissionStatus.SUBMITTED ||
    status === CorpSubmissionStatus.FINANCE_MANAGER_REVIEW
  );
}

const istMonthFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
});

/** Current cycle month in IST as 'YYYY-MM' (the business timezone). */
export function currentMonthIST(): string {
  // en-CA renders 'YYYY-MM-DD'; keep the year-month head.
  return istMonthFmt.format(new Date()).slice(0, 7);
}

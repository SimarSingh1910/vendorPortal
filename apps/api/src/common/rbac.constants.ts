import { UserRole, SubmissionStatus } from '@portal/shared';

/**
 * RBAC / workflow constants derived from the shared enums.
 * Centralized here so guards, the submission state machine, and the lock logic
 * never reference role/status string literals directly.
 */

/** Every role, for "any authenticated user" checks. */
export const ALL_ROLES: readonly UserRole[] = Object.values(UserRole);

/** Roles permitted to enter expense values (data entry). */
export const DATA_ENTRY_ROLES: readonly UserRole[] = [UserRole.CLINIC_SPOC];

/** First-level (clinic) approver roles. */
export const CLINIC_APPROVER_ROLES: readonly UserRole[] = [UserRole.CLINIC_MANAGER];

/** Finance-level approver / unlock roles. */
export const FINANCE_APPROVER_ROLES: readonly UserRole[] = [UserRole.FINANCE_ADMIN];

/**
 * Statuses in which a submission is locked from edits.
 * Only FINANCE_ADMIN may unlock FINANCE_APPROVED (with an audited reason).
 */
export const LOCKED_STATUSES: readonly SubmissionStatus[] = [SubmissionStatus.FINANCE_APPROVED];

/** Send-back statuses that return a submission to the SPOC. */
export const SENT_BACK_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SENT_BACK_BY_MANAGER,
  SubmissionStatus.SENT_BACK_BY_FINANCE,
];

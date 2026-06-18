/**
 * "Action needed" emphasis (Iteration 2 / Step 6) — PRESENTATION ONLY.
 *
 * Pure derivation of whether a submission is currently waiting on a given role
 * to act, from the existing workflow status + role. Because acting advances the
 * state machine through the normal flows, the pending flag clears by itself once
 * the task is done — there is no extra mutation, query, or audit row here.
 *
 * Pending sets (per the step spec):
 *   CLINIC_SPOC    — NOT_STARTED, DRAFT, SENT_BACK_BY_MANAGER, SENT_BACK_BY_FINANCE
 *                    (clears at SUBMITTED and beyond)
 *   CLINIC_MANAGER — SUBMITTED, CLINIC_MANAGER_REVIEW   (clears at CLINIC_APPROVED)
 *   FINANCE_*      — CLINIC_APPROVED, FINANCE_REVIEW     (clears at FINANCE_APPROVED)
 *   read-only roles (CLINIC_VIEWER) — never pending
 */

import { SubmissionStatus, UserRole } from './enums';

/** Whether a submission in `status` is currently awaiting action from `role`. */
export function isActionPending(role: UserRole, status: SubmissionStatus): boolean {
  switch (role) {
    case UserRole.CLINIC_SPOC:
      return (
        status === SubmissionStatus.NOT_STARTED ||
        status === SubmissionStatus.DRAFT ||
        status === SubmissionStatus.SENT_BACK_BY_MANAGER ||
        status === SubmissionStatus.SENT_BACK_BY_FINANCE
      );
    case UserRole.CLINIC_MANAGER:
      return (
        status === SubmissionStatus.SUBMITTED ||
        status === SubmissionStatus.CLINIC_MANAGER_REVIEW
      );
    case UserRole.FINANCE_ADMIN:
    case UserRole.FINANCE_MANAGER:
      return (
        status === SubmissionStatus.CLINIC_APPROVED ||
        status === SubmissionStatus.FINANCE_REVIEW
      );
    case UserRole.CLINIC_VIEWER:
    default:
      return false;
  }
}

/** How many of `statuses` are currently awaiting action from `role`. */
export function pendingCount(role: UserRole, statuses: SubmissionStatus[]): number {
  let n = 0;
  for (const status of statuses) {
    if (isActionPending(role, status)) n += 1;
  }
  return n;
}

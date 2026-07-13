/**
 * Corporate "action needed" emphasis — PRESENTATION ONLY, the corporate-tab
 * parallel of ./attention.ts (which is clinic-only). Kept in its own file so the
 * clinic pending logic is untouched.
 *
 * Pure derivation of whether a corporate submission is currently waiting on a
 * given role to act, from its CorpSubmissionStatus + role. Acting advances the
 * state machine, so the flag clears itself — no extra mutation/query/audit.
 *
 * Pending sets (mirroring the corporate 2-level lifecycle):
 *   DEPT_SPOC            — NOT_STARTED, DRAFT, SENT_BACK_TO_SPOC
 *                         (clears at SUBMITTED and beyond)
 *   CORP_FINANCE_MANAGER — SUBMITTED, FINANCE_MANAGER_REVIEW (clears at FINANCE_APPROVED)
 *   FINANCE_ADMIN        — same approver set on the corporate tab
 *   read-only (DEPT_VIEWER) and clinic roles — never pending here
 */

import { CorpSubmissionStatus, UserRole } from './enums';

/** Whether a corporate submission in `status` is currently awaiting action from `role`. */
export function isCorpActionPending(role: UserRole, status: CorpSubmissionStatus): boolean {
  switch (role) {
    case UserRole.DEPT_SPOC:
      return (
        status === CorpSubmissionStatus.NOT_STARTED ||
        status === CorpSubmissionStatus.DRAFT ||
        status === CorpSubmissionStatus.SENT_BACK_TO_SPOC
      );
    case UserRole.CORP_FINANCE_MANAGER:
    case UserRole.FINANCE_ADMIN:
      return (
        status === CorpSubmissionStatus.SUBMITTED ||
        status === CorpSubmissionStatus.FINANCE_MANAGER_REVIEW
      );
    case UserRole.DEPT_VIEWER:
    default:
      return false;
  }
}

/** How many of `statuses` are currently awaiting action from `role` (corporate). */
export function corpPendingCount(role: UserRole, statuses: CorpSubmissionStatus[]): number {
  let n = 0;
  for (const status of statuses) {
    if (isCorpActionPending(role, status)) n += 1;
  }
  return n;
}

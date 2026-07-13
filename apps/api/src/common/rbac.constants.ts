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

/**
 * Finance-level approver / unlock roles. FINANCE_ADMIN and FINANCE_MANAGER have
 * identical authority over the data/workflow (final approval, unlock, value
 * override, master data); the only difference is user management, which stays
 * FINANCE_ADMIN-only and is gated separately on the users controller.
 */
export const FINANCE_APPROVER_ROLES: readonly UserRole[] = [
  UserRole.FINANCE_ADMIN,
  UserRole.FINANCE_MANAGER,
];

/**
 * Statuses in which a submission is locked from edits.
 * A finance approver (Admin or Manager) may unlock FINANCE_APPROVED (with an
 * audited reason).
 */
export const LOCKED_STATUSES: readonly SubmissionStatus[] = [SubmissionStatus.FINANCE_APPROVED];

/** Send-back statuses that return a submission to the SPOC. */
export const SENT_BACK_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SENT_BACK_BY_MANAGER,
  SubmissionStatus.SENT_BACK_BY_FINANCE,
];

// ── Corporate (Phase C2) ─────────────────────────────────────────────────────

/** Corporate data-entry role (department SPOC). Dept Viewer is read-only. */
export const CORP_DATA_ENTRY_ROLES: readonly UserRole[] = [UserRole.DEPT_SPOC];

/**
 * Corporate approver roles — review/open/approve/send-back and value override.
 * The corporate FINANCE_MANAGER (CORP_FINANCE_MANAGER) is the dedicated approver;
 * FINANCE_ADMIN is the only cross-tab role and shares full corporate authority.
 * The clinic FINANCE_MANAGER is deliberately absent (it never sees corporate).
 */
export const CORP_FINANCE_APPROVER_ROLES: readonly UserRole[] = [
  UserRole.FINANCE_ADMIN,
  UserRole.CORP_FINANCE_MANAGER,
];

/** Roles with org-wide access to every corporate department (no assignment rows). */
export const CORP_FULL_DEPARTMENT_ACCESS_ROLES: readonly UserRole[] = [
  UserRole.FINANCE_ADMIN,
  UserRole.CORP_FINANCE_MANAGER,
];

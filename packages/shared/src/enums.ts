/**
 * Domain enums shared between the API and the web client.
 *
 * Single source of truth for role names and submission lifecycle states.
 * The backend mirrors these in the Prisma schema; the frontend uses them for
 * role-based routing and status rendering. No role/status string literals may
 * exist anywhere outside this package.
 */

/** The five user roles. Exactly one role per user. */
export enum UserRole {
  FINANCE_ADMIN = 'FINANCE_ADMIN',
  FINANCE_VIEWER = 'FINANCE_VIEWER',
  CLINIC_MANAGER = 'CLINIC_MANAGER',
  CLINIC_SPOC = 'CLINIC_SPOC',
  CLINIC_VIEWER = 'CLINIC_VIEWER',
}

/**
 * Submission lifecycle (per clinic, per month YYYY-MM) — all 9 states.
 *
 * Happy path:
 *   NOT_STARTED -> DRAFT -> SUBMITTED -> CLINIC_MANAGER_REVIEW
 *     -> CLINIC_APPROVED -> FINANCE_REVIEW -> FINANCE_APPROVED (locked)
 *
 * Send-back states both return the submission to the SPOC.
 */
export enum SubmissionStatus {
  NOT_STARTED = 'NOT_STARTED',
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CLINIC_MANAGER_REVIEW = 'CLINIC_MANAGER_REVIEW',
  CLINIC_APPROVED = 'CLINIC_APPROVED',
  FINANCE_REVIEW = 'FINANCE_REVIEW',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  SENT_BACK_BY_MANAGER = 'SENT_BACK_BY_MANAGER',
  SENT_BACK_BY_FINANCE = 'SENT_BACK_BY_FINANCE',
}

/** Convenience: roles that belong to the Finance side. */
export const FINANCE_ROLES: readonly UserRole[] = [UserRole.FINANCE_ADMIN, UserRole.FINANCE_VIEWER];

/** Convenience: roles scoped to one or more clinics. */
export const CLINIC_ROLES: readonly UserRole[] = [
  UserRole.CLINIC_MANAGER,
  UserRole.CLINIC_SPOC,
  UserRole.CLINIC_VIEWER,
];

/** Human-readable labels for roles. Centralized so UIs never hard-code strings. */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.FINANCE_ADMIN]: 'Finance Admin',
  [UserRole.FINANCE_VIEWER]: 'Finance Viewer',
  [UserRole.CLINIC_MANAGER]: 'Clinic Manager',
  [UserRole.CLINIC_SPOC]: 'Clinic SPOC',
  [UserRole.CLINIC_VIEWER]: 'Clinic Viewer',
};

/** Human-readable labels for submission statuses. */
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  [SubmissionStatus.NOT_STARTED]: 'Not Started',
  [SubmissionStatus.DRAFT]: 'Draft',
  [SubmissionStatus.SUBMITTED]: 'Submitted',
  [SubmissionStatus.CLINIC_MANAGER_REVIEW]: 'Clinic Manager Review',
  [SubmissionStatus.CLINIC_APPROVED]: 'Clinic Approved',
  [SubmissionStatus.FINANCE_REVIEW]: 'Finance Review',
  [SubmissionStatus.FINANCE_APPROVED]: 'Finance Approved (Locked)',
  [SubmissionStatus.SENT_BACK_BY_MANAGER]: 'Sent Back by Manager',
  [SubmissionStatus.SENT_BACK_BY_FINANCE]: 'Sent Back by Finance',
};

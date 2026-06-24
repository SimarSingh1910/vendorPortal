/**
 * Domain enums shared between the API and the web client.
 *
 * Single source of truth for role names and submission lifecycle states.
 * The backend mirrors these in the Prisma schema; the frontend uses them for
 * role-based routing and status rendering. No role/status string literals may
 * exist anywhere outside this package.
 */

/**
 * User roles across BOTH portal tabs. Exactly one role per user.
 *
 * Clinic tab (original module): FINANCE_MANAGER, CLINIC_MANAGER, CLINIC_SPOC,
 * CLINIC_VIEWER. Corporate tab (Corporate Provisions module): the three CORP_/
 * DEPT_ roles below. FINANCE_ADMIN is the only role spanning both tabs.
 *
 * The clinic FINANCE_MANAGER and the corporate CORP_FINANCE_MANAGER are two
 * DISTINCT roles with NO cross-tab visibility — do not merge them.
 */
export enum UserRole {
  FINANCE_ADMIN = 'FINANCE_ADMIN',
  // Clinic tab
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  CLINIC_MANAGER = 'CLINIC_MANAGER',
  CLINIC_SPOC = 'CLINIC_SPOC',
  CLINIC_VIEWER = 'CLINIC_VIEWER',
  // Corporate tab (Corporate Provisions module)
  CORP_FINANCE_MANAGER = 'CORP_FINANCE_MANAGER',
  DEPT_SPOC = 'DEPT_SPOC',
  DEPT_VIEWER = 'DEPT_VIEWER',
}

/**
 * The two top-level modules of the portal, each surfaced as a tab. A user's role
 * determines which tab(s) they may see; FINANCE_ADMIN sees both, every other
 * role exactly one. Enforced on both frontend routing and backend (TabGuard).
 */
export enum PortalTab {
  CLINIC = 'CLINIC',
  CORPORATE = 'CORPORATE',
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

/** Convenience: roles that belong to the Finance side (org-wide, all-clinic scope). */
export const FINANCE_ROLES: readonly UserRole[] = [UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER];

/** Convenience: roles scoped to one or more clinics. */
export const CLINIC_ROLES: readonly UserRole[] = [
  UserRole.CLINIC_MANAGER,
  UserRole.CLINIC_SPOC,
  UserRole.CLINIC_VIEWER,
];

/**
 * Convenience: the Corporate Provisions roles (Corporate tab only). The
 * clinic-equivalent roles (DEPT_SPOC / DEPT_VIEWER) may hold MULTIPLE departments
 * — unlike clinic roles, which are one-clinic each. CORP_FINANCE_MANAGER is the
 * corporate approver and is distinct from the clinic FINANCE_MANAGER.
 */
export const CORPORATE_ROLES: readonly UserRole[] = [
  UserRole.CORP_FINANCE_MANAGER,
  UserRole.DEPT_SPOC,
  UserRole.DEPT_VIEWER,
];

/**
 * Which tab(s) each role may see — the single source of truth for tab visibility,
 * consumed by frontend routing and the backend TabGuard. FINANCE_ADMIN is the
 * ONLY role spanning both tabs; every other role sees exactly one.
 */
export const ROLE_TABS: Record<UserRole, readonly PortalTab[]> = {
  [UserRole.FINANCE_ADMIN]: [PortalTab.CLINIC, PortalTab.CORPORATE],
  [UserRole.FINANCE_MANAGER]: [PortalTab.CLINIC],
  [UserRole.CLINIC_MANAGER]: [PortalTab.CLINIC],
  [UserRole.CLINIC_SPOC]: [PortalTab.CLINIC],
  [UserRole.CLINIC_VIEWER]: [PortalTab.CLINIC],
  [UserRole.CORP_FINANCE_MANAGER]: [PortalTab.CORPORATE],
  [UserRole.DEPT_SPOC]: [PortalTab.CORPORATE],
  [UserRole.DEPT_VIEWER]: [PortalTab.CORPORATE],
};

/** The tab(s) a role may access. */
export function tabsForRole(role: UserRole): readonly PortalTab[] {
  return ROLE_TABS[role] ?? [];
}

/** Whether a role may access a given tab (used by both routing and the API guard). */
export function roleCanAccessTab(role: UserRole, tab: PortalTab): boolean {
  return tabsForRole(role).includes(tab);
}

/** Human-readable labels for roles. Centralized so UIs never hard-code strings. */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.FINANCE_ADMIN]: 'Finance Admin',
  [UserRole.FINANCE_MANAGER]: 'Finance Manager',
  [UserRole.CLINIC_MANAGER]: 'Clinic Manager',
  [UserRole.CLINIC_SPOC]: 'Clinic SPOC',
  [UserRole.CLINIC_VIEWER]: 'Clinic Viewer',
  [UserRole.CORP_FINANCE_MANAGER]: 'Corporate Finance Manager',
  [UserRole.DEPT_SPOC]: 'Department SPOC',
  [UserRole.DEPT_VIEWER]: 'Department Viewer',
};

/** Human-readable labels for the portal tabs. */
export const TAB_LABELS: Record<PortalTab, string> = {
  [PortalTab.CLINIC]: 'Clinic Provisions',
  [PortalTab.CORPORATE]: 'Corporate Provisions',
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

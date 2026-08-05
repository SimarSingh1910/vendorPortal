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

/**
 * Corporate department classification. SHARED_COST_POOL is the single Sec 24
 * department carrying an HCL Avitas allocation %; STANDARD and INTERNAL_BU are
 * ordinary corporate/HQ departments.
 */
export enum CorpDepartmentType {
  STANDARD = 'STANDARD',
  INTERNAL_BU = 'INTERNAL_BU',
  SHARED_COST_POOL = 'SHARED_COST_POOL',
}

/**
 * Corporate submission lifecycle (per department, per month YYYY-MM) — a 2-level
 * workflow with no intermediate approver (distinct from the clinic 9-state one):
 *
 *   NOT_STARTED -> DRAFT -> SUBMITTED -> FINANCE_MANAGER_REVIEW
 *     -> FINANCE_APPROVED (locked)
 *
 * SENT_BACK_TO_SPOC returns the submission straight to the Dept SPOC; resubmit
 * goes back to SUBMITTED. FINANCE_MANAGER_REVIEW here is a workflow STATE,
 * unrelated to the CORP_FINANCE_MANAGER role name.
 */
export enum CorpSubmissionStatus {
  NOT_STARTED = 'NOT_STARTED',
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  FINANCE_MANAGER_REVIEW = 'FINANCE_MANAGER_REVIEW',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  SENT_BACK_TO_SPOC = 'SENT_BACK_TO_SPOC',
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
 * Convenience: the corporate roles scoped to one or more departments
 * (Dept SPOC / Viewer) — the ones carrying user_department_assignments rows.
 * CORP_FINANCE_MANAGER is deliberately EXCLUDED: like the clinic FINANCE_MANAGER
 * it auto-sees every department and holds NO assignment rows. Unlike clinic
 * roles (one clinic each), these may hold MULTIPLE departments.
 */
export const DEPT_SCOPED_ROLES: readonly UserRole[] = [
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

/**
 * Every role belonging to a portal's user list — the single source for the
 * user-management clinic/corporate split. Derived from ROLE_TABS, so FINANCE_ADMIN
 * (the only cross-tab role) appears in BOTH lists and the clinic FINANCE_MANAGER
 * stays clinic-only. Order follows the UserRole enum.
 */
export function rolesForTab(tab: PortalTab): UserRole[] {
  return (Object.values(UserRole) as UserRole[]).filter((role) => roleCanAccessTab(role, tab));
}

/** Human-readable labels for roles. Centralized so UIs never hard-code strings. */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.FINANCE_ADMIN]: 'Finance Admin',
  [UserRole.FINANCE_MANAGER]: 'Finance Manager',
  // Business name is "Cluster Manager"; the ENUM VALUE stays CLINIC_MANAGER on
  // purpose — it is persisted in the DB and baked into append-only audit action
  // names, so renaming the identifier would fork the audit history. This label is
  // the single place the user-facing name is defined.
  [UserRole.CLINIC_MANAGER]: 'Cluster Manager',
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
  // DRAFT reads as "Not Started" too, by request. To anyone reviewing a cycle the
  // two are the same thing — nothing has been submitted — and the distinction
  // (cycle opened vs. SPOC part-way through) is internal bookkeeping. The ENUM
  // VALUES stay separate: they drive different workflow transitions, are persisted,
  // and are baked into audit history. Only the label is shared.
  [SubmissionStatus.DRAFT]: 'Not Started',
  [SubmissionStatus.SUBMITTED]: 'Submitted',
  [SubmissionStatus.CLINIC_MANAGER_REVIEW]: 'Cluster Manager Review',
  [SubmissionStatus.CLINIC_APPROVED]: 'Clinic Approved',
  [SubmissionStatus.FINANCE_REVIEW]: 'Finance Review',
  [SubmissionStatus.FINANCE_APPROVED]: 'Finance Approved (Locked)',
  [SubmissionStatus.SENT_BACK_BY_MANAGER]: 'Sent Back by Manager',
  [SubmissionStatus.SENT_BACK_BY_FINANCE]: 'Sent Back by Finance',
};

/**
 * Every status that SHARES a label with the given one — itself, plus any other
 * status the UI presents under the same name (today: NOT_STARTED and DRAFT both
 * read "Not Started").
 *
 * This exists so a merged label stays honest in a FILTER. Two options reading
 * "Not Started" that match different rows would be a trap: picking one would
 * silently omit half the clinics the user meant. Filters therefore offer one
 * option per distinct LABEL and expand it back to every status behind it.
 */
export function statusesSharingLabel(status: SubmissionStatus): SubmissionStatus[] {
  const label = SUBMISSION_STATUS_LABELS[status];
  return (Object.values(SubmissionStatus) as SubmissionStatus[]).filter(
    (s) => SUBMISSION_STATUS_LABELS[s] === label,
  );
}

/** One entry per DISTINCT status label, for filter dropdowns. */
export const SUBMISSION_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  id: SubmissionStatus;
  name: string;
}> = (Object.values(SubmissionStatus) as SubmissionStatus[])
  .filter(
    (s, i, all) =>
      all.findIndex((o) => SUBMISSION_STATUS_LABELS[o] === SUBMISSION_STATUS_LABELS[s]) === i,
  )
  .map((s) => ({ id: s, name: SUBMISSION_STATUS_LABELS[s] }));

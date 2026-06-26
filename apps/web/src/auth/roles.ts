import { PortalTab, UserRole, tabsForRole } from '@portal/shared';

/**
 * Finance staff with full powers. FINANCE_ADMIN and FINANCE_MANAGER share every
 * finance screen; only FINANCE_ADMIN additionally sees User Management.
 */
const FINANCE_FULL: UserRole[] = [UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER];

/**
 * Roles that may see the Corporate tab: the corporate-only roles plus
 * FINANCE_ADMIN (the only role spanning both tabs). The clinic FINANCE_MANAGER
 * is intentionally absent — it is a distinct role with no corporate visibility.
 */
const CORP_VISIBLE: UserRole[] = [
  UserRole.FINANCE_ADMIN,
  UserRole.CORP_FINANCE_MANAGER,
  UserRole.DEPT_SPOC,
  UserRole.DEPT_VIEWER,
];

/** Corporate approvers — the review/approve/unlock side (org-wide scope). */
const CORP_APPROVER: UserRole[] = [UserRole.FINANCE_ADMIN, UserRole.CORP_FINANCE_MANAGER];

/** Department users who enter/view a department's provision form. */
const CORP_DEPT_USERS: UserRole[] = [UserRole.DEPT_SPOC, UserRole.DEPT_VIEWER];

/** Landing path for the Corporate tab (placeholder until corporate screens land). */
export const CORPORATE_HOME = '/corporate';

/** Where each role lands after login / when hitting the app root. */
export const ROLE_HOME: Record<UserRole, string> = {
  [UserRole.FINANCE_ADMIN]: '/finance',
  [UserRole.FINANCE_MANAGER]: '/finance',
  [UserRole.CLINIC_MANAGER]: '/manager',
  [UserRole.CLINIC_SPOC]: '/spoc',
  [UserRole.CLINIC_VIEWER]: '/viewer',
  // Corporate-only roles land in the Corporate tab.
  [UserRole.CORP_FINANCE_MANAGER]: CORPORATE_HOME,
  [UserRole.DEPT_SPOC]: CORPORATE_HOME,
  [UserRole.DEPT_VIEWER]: CORPORATE_HOME,
};

export function roleHome(role: UserRole): string {
  return ROLE_HOME[role] ?? '/login';
}

/** Which tab a given route path belongs to (corporate routes are prefixed). */
export function tabForPath(pathname: string): PortalTab {
  return pathname === CORPORATE_HOME || pathname.startsWith(`${CORPORATE_HOME}/`)
    ? PortalTab.CORPORATE
    : PortalTab.CLINIC;
}

/** Landing path for a given tab. Clinic uses the role's own home; corporate is fixed. */
export function tabHome(role: UserRole, tab: PortalTab): string {
  return tab === PortalTab.CORPORATE ? CORPORATE_HOME : roleHome(role);
}

/** The tabs a role may switch between (drives the top-level tab switch). */
export function rolePortalTabs(role: UserRole): readonly PortalTab[] {
  return tabsForRole(role);
}

export interface NavItem {
  path: string;
  label: string;
  roles: UserRole[];
  /** Which tab this item belongs under (filtered out when the other tab is active). */
  tab: PortalTab;
}

/**
 * Sidebar navigation. Items are filtered by the current role (defense in depth —
 * the backend independently enforces access; hiding is purely UX).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/finance', label: 'Finance', roles: FINANCE_FULL, tab: PortalTab.CLINIC },
  { path: '/finance/dashboard', label: 'Dashboard', roles: FINANCE_FULL, tab: PortalTab.CLINIC },
  // Master-data management (create/edit) is FINANCE_ADMIN-only; the manager keeps
  // finance review, dashboards, audit, exports and notification config.
  { path: '/admin/clinics', label: 'Clinics', roles: [UserRole.FINANCE_ADMIN], tab: PortalTab.CLINIC },
  { path: '/admin/expense-heads', label: 'Expense Heads', roles: [UserRole.FINANCE_ADMIN], tab: PortalTab.CLINIC },
  { path: '/admin/mappings', label: 'Mappings', roles: [UserRole.FINANCE_ADMIN], tab: PortalTab.CLINIC },
  { path: '/admin/users', label: 'Users', roles: [UserRole.FINANCE_ADMIN], tab: PortalTab.CLINIC },
  { path: '/admin/notifications', label: 'Notification Config', roles: FINANCE_FULL, tab: PortalTab.CLINIC },
  { path: '/admin/audit', label: 'Audit Log', roles: FINANCE_FULL, tab: PortalTab.CLINIC },
  { path: '/manager', label: 'Clinic Manager', roles: [UserRole.CLINIC_MANAGER], tab: PortalTab.CLINIC },
  { path: '/spoc', label: 'Data Entry', roles: [UserRole.CLINIC_SPOC], tab: PortalTab.CLINIC },
  {
    path: '/clinic/dashboard',
    label: 'Dashboard',
    roles: [UserRole.CLINIC_MANAGER, UserRole.CLINIC_SPOC],
    tab: PortalTab.CLINIC,
  },
  { path: '/viewer', label: 'Clinic View', roles: [UserRole.CLINIC_VIEWER], tab: PortalTab.CLINIC },
  // Corporate tab (Corporate Provisions module).
  { path: CORPORATE_HOME, label: 'Departments', roles: CORP_VISIBLE, tab: PortalTab.CORPORATE },
  { path: '/corporate/review', label: 'Review Queue', roles: CORP_APPROVER, tab: PortalTab.CORPORATE },
  { path: '/corporate/dashboard', label: 'Dashboard', roles: CORP_VISIBLE, tab: PortalTab.CORPORATE },
];

/** Allowed roles per protected route path (single source for router + guard). */
export const ROUTE_ROLES: Record<string, UserRole[]> = {
  '/finance': FINANCE_FULL,
  '/finance/dashboard': FINANCE_FULL,
  '/finance/submissions': FINANCE_FULL,
  '/admin/clinics': [UserRole.FINANCE_ADMIN],
  '/admin/expense-heads': [UserRole.FINANCE_ADMIN],
  '/admin/mappings': [UserRole.FINANCE_ADMIN],
  '/admin/users': [UserRole.FINANCE_ADMIN],
  '/admin/notifications': FINANCE_FULL,
  '/admin/audit': FINANCE_FULL,
  '/manager': [UserRole.CLINIC_MANAGER],
  '/manager/submissions': [UserRole.CLINIC_MANAGER],
  '/spoc': [UserRole.CLINIC_SPOC],
  '/spoc/submissions': [UserRole.CLINIC_SPOC],
  '/clinic/dashboard': [UserRole.CLINIC_MANAGER, UserRole.CLINIC_SPOC],
  '/viewer': [UserRole.CLINIC_VIEWER],
  // Corporate tab — visible to corporate roles + the cross-tab FINANCE_ADMIN.
  [CORPORATE_HOME]: CORP_VISIBLE,
  '/corporate/submissions': CORP_DEPT_USERS,
  '/corporate/review': CORP_APPROVER,
  '/corporate/dashboard': CORP_VISIBLE,
};

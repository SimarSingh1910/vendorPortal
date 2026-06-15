import { UserRole } from '@portal/shared';

/** Where each role lands after login / when hitting the app root. */
export const ROLE_HOME: Record<UserRole, string> = {
  [UserRole.FINANCE_ADMIN]: '/finance',
  [UserRole.FINANCE_VIEWER]: '/finance',
  [UserRole.CLINIC_MANAGER]: '/manager',
  [UserRole.CLINIC_SPOC]: '/spoc',
  [UserRole.CLINIC_VIEWER]: '/viewer',
};

export function roleHome(role: UserRole): string {
  return ROLE_HOME[role] ?? '/login';
}

export interface NavItem {
  path: string;
  label: string;
  roles: UserRole[];
}

/**
 * Sidebar navigation. Items are filtered by the current role (defense in depth —
 * the backend independently enforces access; hiding is purely UX).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/finance', label: 'Finance', roles: [UserRole.FINANCE_ADMIN, UserRole.FINANCE_VIEWER] },
  { path: '/admin/clinics', label: 'Clinics', roles: [UserRole.FINANCE_ADMIN] },
  { path: '/admin/expense-heads', label: 'Expense Heads', roles: [UserRole.FINANCE_ADMIN] },
  { path: '/admin/mappings', label: 'Mappings', roles: [UserRole.FINANCE_ADMIN] },
  { path: '/admin/users', label: 'Users', roles: [UserRole.FINANCE_ADMIN] },
  { path: '/manager', label: 'Clinic Manager', roles: [UserRole.CLINIC_MANAGER] },
  { path: '/spoc', label: 'Data Entry', roles: [UserRole.CLINIC_SPOC] },
  { path: '/viewer', label: 'Clinic View', roles: [UserRole.CLINIC_VIEWER] },
];

/** Allowed roles per protected route path (single source for router + guard). */
export const ROUTE_ROLES: Record<string, UserRole[]> = {
  '/finance': [UserRole.FINANCE_ADMIN, UserRole.FINANCE_VIEWER],
  '/admin/clinics': [UserRole.FINANCE_ADMIN],
  '/admin/expense-heads': [UserRole.FINANCE_ADMIN],
  '/admin/mappings': [UserRole.FINANCE_ADMIN],
  '/admin/users': [UserRole.FINANCE_ADMIN],
  '/manager': [UserRole.CLINIC_MANAGER],
  '/spoc': [UserRole.CLINIC_SPOC],
  '/viewer': [UserRole.CLINIC_VIEWER],
};

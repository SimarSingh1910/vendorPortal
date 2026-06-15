import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { UserRole } from '@portal/shared';
import { useAuthStore } from '@/store/auth.store';
import { roleHome } from '@/auth/roles';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

/**
 * Gates a route on authentication AND an allowed-roles list.
 * - Not authenticated → redirect to /login.
 * - Authenticated but role not allowed → redirect to the user's own home
 *   (so a manual URL to a forbidden route bounces back).
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace />;
  }
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <>{children}</>;
}

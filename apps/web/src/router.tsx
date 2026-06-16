import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthedShell } from '@/layouts/AuthedShell';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { ROUTE_ROLES, roleHome } from '@/auth/roles';
import { Login } from '@/pages/Login';
import { RoleHome } from '@/pages/RoleHome';
import { ClinicsAdmin } from '@/pages/admin/ClinicsAdmin';
import { ExpenseHeadsAdmin } from '@/pages/admin/ExpenseHeadsAdmin';
import { MappingsAdmin } from '@/pages/admin/MappingsAdmin';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';
import { AuditAdmin } from '@/pages/admin/AuditAdmin';
import { NotificationConfigAdmin } from '@/pages/admin/NotificationConfigAdmin';
import { SpocHome } from '@/pages/spoc/SpocHome';
import { SubmissionEntry } from '@/pages/spoc/SubmissionEntry';
import { ManagerHome } from '@/pages/manager/ManagerHome';
import { ManagerReview } from '@/pages/manager/ManagerReview';
import { FinanceHome } from '@/pages/finance/FinanceHome';
import { FinanceReview } from '@/pages/finance/FinanceReview';
import { useAuthStore } from '@/store/auth.store';

/** Root: send authenticated users to their role home, everyone else to login. */
function HomeRedirect() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  if (status === 'authenticated' && user) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Navigate to="/login" replace />;
}

/**
 * Role-based routing. The authenticated branch is wrapped by AuthedShell (auth
 * gate + chrome + idle timer); each leaf is additionally gated by ProtectedRoute
 * on its allowed roles, so a manual URL to a forbidden route bounces back.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <AuthedShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        path: 'finance',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/finance']}>
            <FinanceHome />
          </ProtectedRoute>
        ),
      },
      {
        path: 'finance/submissions/:submissionId',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/finance/submissions']}>
            <FinanceReview />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/clinics',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/clinics']}>
            <ClinicsAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/expense-heads',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/expense-heads']}>
            <ExpenseHeadsAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/mappings',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/mappings']}>
            <MappingsAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/users']}>
            <UsersAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/notifications',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/notifications']}>
            <NotificationConfigAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/audit',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/admin/audit']}>
            <AuditAdmin />
          </ProtectedRoute>
        ),
      },
      {
        path: 'manager',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/manager']}>
            <ManagerHome />
          </ProtectedRoute>
        ),
      },
      {
        path: 'manager/submissions/:submissionId',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/manager/submissions']}>
            <ManagerReview />
          </ProtectedRoute>
        ),
      },
      {
        path: 'spoc',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/spoc']}>
            <SpocHome />
          </ProtectedRoute>
        ),
      },
      {
        path: 'spoc/submissions/:submissionId',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/spoc/submissions']}>
            <SubmissionEntry />
          </ProtectedRoute>
        ),
      },
      {
        path: 'viewer',
        element: (
          <ProtectedRoute allowedRoles={ROUTE_ROLES['/viewer']}>
            <RoleHome />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

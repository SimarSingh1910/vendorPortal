import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthedShell } from '@/layouts/AuthedShell';
import { DashboardPlaceholder } from '@/pages/DashboardPlaceholder';

/**
 * App router. Role-based protected routes will wrap these once auth exists;
 * for the scaffold every path lands inside the authed shell.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AuthedShell />,
    children: [
      { index: true, element: <DashboardPlaceholder /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

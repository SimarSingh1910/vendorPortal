import { useCallback } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { Building2, LogOut, PanelLeft } from 'lucide-react';
import { ROLE_LABELS } from '@portal/shared';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { useAuthActions } from '@/auth/useAuthActions';
import { useIdleTimer } from '@/auth/useIdleTimer';
import { NAV_ITEMS } from '@/auth/roles';
import { cn } from '@/lib/utils';

/**
 * Authenticated app shell: top bar + role-filtered sidebar + content outlet.
 * Gates on authentication, hosts the 30-min idle auto-logout, and exposes a
 * manual logout. Nav items are filtered to the user's role (defense in depth —
 * the backend independently enforces access).
 */
export function AuthedShell() {
  const { sidebarOpen, toggleSidebar } = useUiStore();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { logout } = useAuthActions();

  const authenticated = status === 'authenticated' && !!user;

  // Idle auto-logout (active only while authenticated).
  const handleIdle = useCallback(() => {
    void logout();
  }, [logout]);
  useIdleTimer(handleIdle, authenticated);

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <PanelLeft />
        </Button>
        <div className="flex items-center gap-2 font-semibold">
          <Building2 className="text-primary" />
          <span>Cost Provision Portal</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right text-sm leading-tight">
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut />
            Logout
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            'border-r bg-muted/30 transition-all duration-200',
            sidebarOpen ? 'w-60' : 'w-0 overflow-hidden',
          )}
        >
          <nav className="flex flex-col gap-1 p-3 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent font-medium text-accent-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

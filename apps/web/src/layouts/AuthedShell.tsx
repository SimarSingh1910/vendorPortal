import { useCallback } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Building2, LogOut, PanelLeft } from 'lucide-react';
import { ROLE_LABELS, UserRole } from '@portal/shared';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { useAuthActions } from '@/auth/useAuthActions';
import { useIdleTimer } from '@/auth/useIdleTimer';
import { NAV_ITEMS, tabForPath } from '@/auth/roles';
import { NotificationTray } from '@/components/NotificationTray';
import { TabSwitch } from '@/components/TabSwitch';
import { PendingCountBadge } from '@/components/attention';
import { usePendingWork } from '@/hooks/usePendingWork';
import { useCorpPendingWork } from '@/hooks/useCorpPendingWork';
import { cn } from '@/lib/utils';

/** The single nav item that represents each role's "work to do" surface (clinic tab). */
const WORK_PATH_BY_ROLE: Partial<Record<UserRole, string>> = {
  [UserRole.CLINIC_SPOC]: '/spoc',
  [UserRole.CLINIC_MANAGER]: '/manager',
  [UserRole.FINANCE_ADMIN]: '/finance',
  [UserRole.FINANCE_MANAGER]: '/finance',
};

/**
 * The corporate-tab work surface per role (parallel to WORK_PATH_BY_ROLE). The
 * dept SPOC's is the Departments home; approvers' is the Review Queue.
 * FINANCE_ADMIN spans both tabs, so it has a clinic AND a corporate work path.
 */
const CORP_WORK_PATH_BY_ROLE: Partial<Record<UserRole, string>> = {
  [UserRole.DEPT_SPOC]: '/corporate',
  [UserRole.CORP_FINANCE_MANAGER]: '/corporate/review',
  [UserRole.FINANCE_ADMIN]: '/corporate/review',
};

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
  const location = useLocation();
  const { logout } = useAuthActions();

  const authenticated = status === 'authenticated' && !!user;

  // Idle auto-logout (active only while authenticated).
  const handleIdle = useCallback(() => {
    void logout();
  }, [logout]);
  useIdleTimer(handleIdle, authenticated);

  // Count of items awaiting the signed-in user (Step 6). Hooks run before the
  // early return; each self-disables and returns 0 when unauthenticated / off-tab.
  const pendingCount = usePendingWork();
  const corpPendingCount = useCorpPendingWork();

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  // Sidebar shows items for the active tab only (the tab switch moves between
  // tabs); within a tab they're further filtered to the user's role.
  const activeTab = tabForPath(location.pathname);
  const navItems = NAV_ITEMS.filter(
    (item) => item.tab === activeTab && item.roles.includes(user.role),
  );
  const workPath = WORK_PATH_BY_ROLE[user.role];
  const corpWorkPath = CORP_WORK_PATH_BY_ROLE[user.role];

  // Nav highlight: longest-prefix wins. A route matches an item when it equals
  // the item's path or sits under it, but a child item (e.g. /finance/dashboard)
  // wins over its parent (/finance) so only one item lights up at a time.
  const isNavActive = (itemPath: string): boolean => {
    const p = location.pathname;
    const matches = p === itemPath || p.startsWith(`${itemPath}/`);
    if (!matches) return false;
    return !navItems.some(
      (other) =>
        other.path !== itemPath &&
        other.path.length > itemPath.length &&
        (p === other.path || p.startsWith(`${other.path}/`)),
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <PanelLeft />
        </Button>
        <div className="flex items-center gap-2 font-semibold">
          <Building2 className="text-primary" />
          <span>Cost Provision Portal</span>
        </div>
        <div className="ml-6">
          <TabSwitch />
        </div>
        <div className="ml-auto flex items-center gap-4">
          <NotificationTray />
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

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            'shrink-0 border-r border-white/[0.12] bg-sidebar text-sidebar-foreground transition-all duration-200',
            sidebarOpen ? 'w-60 overflow-y-auto' : 'w-0 overflow-hidden',
          )}
        >
          <nav className="flex flex-col gap-1 p-3 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  // Focus ring is white so it stays visible on the navy surface
                  // (the #1E40AF ring would disappear against it).
                  'flex items-center justify-between gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                  // Idle and active are mutually exclusive so exactly one text
                  // colour ever applies — no ambiguous same-property overrides.
                  isNavActive(item.path)
                    ? 'bg-sidebar-active font-medium text-sidebar-active-foreground'
                    : 'text-sidebar-foreground hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <span>{item.label}</span>
                {item.path === workPath && <PendingCountBadge count={pendingCount} />}
                {item.path === corpWorkPath && <PendingCountBadge count={corpPendingCount} />}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

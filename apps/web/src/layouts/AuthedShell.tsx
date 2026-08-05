import { useCallback } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Boxes,
  Building2,
  ChevronLeft,
  ClipboardCheck,
  Eye,
  Inbox,
  LayoutDashboard,
  ListTree,
  LogOut,
  PanelLeft,
  Percent,
  ScrollText,
  SquarePen,
  Users,
  Wallet,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS, UserRole } from '@portal/shared';
// White HCL lockup for the dark navy sidebar (reference "Clarity" shell).
import hclLogoWhite from '@/assets/images.png';
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
 * Nav-item icons, keyed by label (duplicate labels across tabs share an icon).
 * Purely presentational — the nav contents/order/routes come from NAV_ITEMS.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  Finance: Wallet,
  Dashboard: LayoutDashboard,
  Clinics: Building2,
  'Expense Heads': ListTree,
  Mappings: Waypoints,
  Users: Users,
  'Notification Config': Bell,
  'Audit Log': ScrollText,
  // Keyed by the NAV LABEL — keep in step with roles.ts or the icon silently drops.
  'Cluster Manager': ClipboardCheck,
  'Data Entry': SquarePen,
  'Clinic View': Eye,
  Departments: Boxes,
  'Review Queue': Inbox,
  'Department Masters': Building2,
  'Sec 24 Config': Percent,
};

/** Up-to-two-letter initials from a display name (e.g. "Ritu Ananth" → "RA"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/**
 * Authenticated app shell: top bar + role-filtered navy sidebar + content outlet.
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
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-white/[0.16] bg-sidebar text-sidebar-foreground transition-all duration-200',
            sidebarOpen ? 'w-60' : 'w-0 overflow-hidden',
          )}
        >
          {/* Brand: white HCL lockup + app name on the dark surface. */}
          <div className="shrink-0 px-4 pb-3 pt-4">
            <img src={hclLogoWhite} alt="HCL Healthcare" className="h-6 w-auto" />
            <p className="mt-2 text-xs text-sidebar-foreground/80">Cost Provision Portal</p>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-2 text-sm">
            <div className="flex flex-col gap-1">
              {navItems.map((item) => {
                const Icon = NAV_ICONS[item.label];
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={cn(
                      // A 3px left bar marks the active item; idle keeps a transparent
                      // bar of the same width so nothing shifts. Focus ring is white
                      // (the brand-accent ring would disappear against the navy).
                      'flex items-center justify-between gap-2 rounded-md border-l-[3px] px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                      // Active = white text on the #0067B4 pill with the white bar;
                      // idle is the soft light-blue text, brightening to white on a
                      // white/10% hover.
                      isNavActive(item.path)
                        ? 'border-[#4579B3] bg-sidebar-active text-sidebar-active-foreground'
                        : 'border-transparent text-sidebar-foreground hover:bg-white/[0.10] hover:text-white',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      {Icon && <Icon className="size-4 shrink-0" />}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.path === workPath && <PendingCountBadge count={pendingCount} />}
                    {item.path === corpWorkPath && <PendingCountBadge count={corpPendingCount} />}
                  </NavLink>
                );
              })}
            </div>
          </nav>

          {/* User chip pinned to the bottom (identity from the session). */}
          <div className="shrink-0 border-t border-white/[0.16] p-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-sm font-semibold text-white">
                {initialsOf(user.name)}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                {/* Real staff names run well past this column ("Dr.Chillara Anjana
                    Sesha Kiranmayi"), so keep the full one on hover. */}
                <div className="truncate text-sm font-medium text-white" title={user.name}>
                  {user.name}
                </div>
                <div className="truncate text-xs text-sidebar-foreground">
                  {ROLE_LABELS[user.role]}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                className="shrink-0 rounded-md p-1 text-sidebar-foreground transition-colors hover:bg-white/[0.10] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 px-4">
            <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <PanelLeft />
            </Button>
            <TabSwitch />
            <div className="ml-auto flex items-center gap-3">
              <NotificationTray />
              {/* Minimalist vertical divider between the bell and Logout. */}
              <div className="h-5 w-px bg-border" aria-hidden="true" />
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                <LogOut />
                Logout
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
    </div>
  );
}

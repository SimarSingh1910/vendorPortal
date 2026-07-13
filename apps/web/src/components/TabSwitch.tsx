import { Link, useLocation } from 'react-router-dom';
import { TAB_LABELS } from '@portal/shared';
import { useAuthStore } from '@/store/auth.store';
import { rolePortalTabs, tabForPath, tabHome } from '@/auth/roles';
import { cn } from '@/lib/utils';

/**
 * Top-level [Clinic Provisions] [Corporate Provisions] switch. Renders only the
 * tab(s) the signed-in role may see (the frontend half of tab visibility — the
 * API independently enforces it via TabGuard): FINANCE_ADMIN sees both, every
 * other role exactly one. Clicking a tab navigates to that module's home.
 */
export function TabSwitch() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (!user) return null;

  const tabs = rolePortalTabs(user.role);
  if (tabs.length === 0) return null;

  const activeTab = tabForPath(location.pathname);

  return (
    <nav
      aria-label="Portal module"
      className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {tabs.map((tab) => {
        const active = tab === activeTab;
        return (
          <Link
            key={tab}
            to={tabHome(user.role, tab)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}

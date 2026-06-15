import { Outlet } from 'react-router-dom';
import { Building2, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/ui.store';
import { cn } from '@/lib/utils';

/**
 * Placeholder authenticated app shell: top bar + collapsible sidebar + content
 * outlet. Real auth gating and role-based navigation arrive in a later step;
 * for now it renders a blank authed page so the scaffold is verifiable.
 */
export function AuthedShell() {
  const { sidebarOpen, toggleSidebar } = useUiStore();

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
        <span className="ml-auto text-sm text-muted-foreground">HCL Avitas</span>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            'border-r bg-muted/30 transition-all duration-200',
            sidebarOpen ? 'w-60' : 'w-0 overflow-hidden',
          )}
        >
          <nav className="p-4 text-sm text-muted-foreground">
            {/* Navigation populated once auth + roles land. */}
            <p className="px-2 py-1">Navigation</p>
          </nav>
        </aside>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

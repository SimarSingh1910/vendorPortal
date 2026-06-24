import { ROLE_LABELS, TAB_LABELS, PortalTab } from '@portal/shared';
import { useAuthStore } from '@/store/auth.store';

/**
 * Corporate Provisions tab landing page (Step C0.1 scaffolding). The corporate
 * module's screens — department entry, budget codes, Sec 24, review/approval and
 * dashboards — arrive in later steps. This placeholder exists so the tab is
 * reachable and role-gated end to end from the very first step.
 */
export function CorporateHome() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{TAB_LABELS[PortalTab.CORPORATE]}</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium">{ROLE_LABELS[user.role]}</span> ({user.email}).
        </p>
      </div>

      <section className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        The Corporate Provisions module is being built. Department data entry, budget codes, the
        Sec 24 shared-cost pool, review &amp; approval and corporate dashboards arrive in later steps.
      </section>
    </div>
  );
}

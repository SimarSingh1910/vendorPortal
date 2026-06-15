import { ROLE_LABELS } from '@portal/shared';
import { useAuthStore } from '@/store/auth.store';

/**
 * Per-role landing page. Each protected route renders this; content adapts to
 * the signed-in user's role. Placeholder until the role-specific dashboards and
 * the cost-provision workflow are built in later phases.
 */
export function RoleHome() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.name}
        </h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium">{ROLE_LABELS[user.role]}</span> ({user.email}).
        </p>
      </div>

      <section className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        This is your role home. Role-specific dashboards and the cost-provision workflow arrive in
        later phases.
        {user.clinicIds.length > 0 && (
          <span className="mt-2 block">
            Assigned clinics: <span className="font-medium">{user.clinicIds.length}</span>
          </span>
        )}
      </section>
    </div>
  );
}

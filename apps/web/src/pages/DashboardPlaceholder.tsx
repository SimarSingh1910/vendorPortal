import {
  UserRole,
  SubmissionStatus,
  ROLE_LABELS,
  SUBMISSION_STATUS_LABELS,
} from '@portal/shared';

/**
 * Blank authed-shell landing page for the scaffold. It doubles as a live check
 * that the web build consumes the shared enums: roles and statuses below are
 * rendered entirely from @portal/shared (no hard-coded strings here).
 */
export function DashboardPlaceholder() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Scaffold ready. Authentication, role-based routing, and the cost-provision workflow will be
          built in subsequent steps.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Roles</h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(UserRole).map((role) => (
            <span
              key={role}
              className="rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium"
            >
              {ROLE_LABELS[role]}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Submission statuses</h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(SubmissionStatus).map((status) => (
            <span
              key={status}
              className="rounded-md border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground"
            >
              {SUBMISSION_STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

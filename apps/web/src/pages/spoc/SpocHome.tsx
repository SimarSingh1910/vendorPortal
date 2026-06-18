import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  isActionPending,
  SubmissionStatus,
  UserRole,
  type ClinicMonthStatus,
} from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOverview } from '@/api/submissions';
import { ClinicApprovedHistory } from '@/components/submissions/ClinicApprovedHistory';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
  PendingCountBadge,
} from '@/components/attention';
import { formatMonth, statusBadgeVariant, statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

/** This clinic's current-month entry is still owed by the SPOC. */
function isEntryPending(row: ClinicMonthStatus): boolean {
  return !!row.submissionId && isActionPending(UserRole.CLINIC_SPOC, row.status);
}

/** What the SPOC can do with a clinic's current-month submission. */
function primaryAction(row: ClinicMonthStatus): { label: string; actionable: boolean } {
  if (!row.submissionId) return { label: 'Awaiting cycle open', actionable: false };
  switch (row.status) {
    case SubmissionStatus.NOT_STARTED:
      return { label: 'Start entry', actionable: true };
    case SubmissionStatus.DRAFT:
      return { label: 'Continue entry', actionable: true };
    case SubmissionStatus.SENT_BACK_BY_MANAGER:
    case SubmissionStatus.SENT_BACK_BY_FINANCE:
      return { label: 'Revise & resubmit', actionable: true };
    default:
      return { label: 'View', actionable: true };
  }
}

export function SpocHome() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
  });

  const month = rows[0]?.month;
  const pendingCount = rows.filter(isEntryPending).length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cost Provision — Data Entry</h1>
        <p className="text-sm text-muted-foreground">
          Your clinics{month ? ` for ${formatMonth(month)}` : ''}. Enter the monthly estimate and
          submit it for review.
        </p>
      </div>

      {pendingCount > 0 && (
        <AttentionBanner>
          {pendingCount === 1
            ? 'Action needed — 1 clinic is awaiting your data entry this month.'
            : `Action needed — ${pendingCount} clinics are awaiting your data entry this month.`}
        </AttentionBanner>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Current month</h2>
          <PendingCountBadge count={pendingCount} />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No clinics assigned to you.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const action = primaryAction(row);
                  const pending = isEntryPending(row);
                  return (
                    <TableRow key={row.clinicId} className={cn(pending && attentionAccentClass)}>
                      <TableCell className="font-medium">{row.clinicName}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(row.status)}>
                            {statusLabel(row.status)}
                          </Badge>
                          {pending && <ActionNeededBadge />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {action.actionable && row.submissionId ? (
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/spoc/submissions/${row.submissionId}`}>{action.label}</Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{action.label}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Past approved months</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          rows.map((row) => (
            <ClinicApprovedHistory
              key={row.clinicId}
              clinicId={row.clinicId}
              clinicName={row.clinicName}
              linkBase="/spoc/submissions"
            />
          ))
        )}
      </section>
    </div>
  );
}

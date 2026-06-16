import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SubmissionStatus, type ClinicMonthStatus } from '@portal/shared';
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
import { getClinicHistory, getOverview } from '@/api/submissions';
import { formatIST, formatMonth, statusBadgeVariant, statusLabel } from '@/lib/format';

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

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cost Provision — Data Entry</h1>
        <p className="text-sm text-muted-foreground">
          Your clinics{month ? ` for ${formatMonth(month)}` : ''}. Enter the monthly estimate and
          submit it for review.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Current month</h2>
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
                  return (
                    <TableRow key={row.clinicId}>
                      <TableCell className="font-medium">{row.clinicName}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(row.status)}>
                          {statusLabel(row.status)}
                        </Badge>
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
            <ClinicApprovedHistory key={row.clinicId} clinicId={row.clinicId} clinicName={row.clinicName} />
          ))
        )}
      </section>
    </div>
  );
}

/** Locked (FINANCE_APPROVED) months for a clinic — read-only links. */
function ClinicApprovedHistory({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  const { data = [] } = useQuery({
    queryKey: ['submissions', 'history', clinicId, SubmissionStatus.FINANCE_APPROVED],
    queryFn: () => getClinicHistory(clinicId, SubmissionStatus.FINANCE_APPROVED),
  });

  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-2 text-sm font-medium">{clinicName}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{formatMonth(item.month)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {item.approvedByFinanceAt ? formatIST(item.approvedByFinanceAt) : '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/spoc/submissions/${item.id}`}>View (locked)</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CorpSubmissionStatus,
  UserRole,
  type CorpDepartmentMonthStatus,
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
import { getCorpOverview } from '@/api/corpSubmissions';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
  PendingCountBadge,
} from '@/components/attention';
import { useAuthStore } from '@/store/auth.store';
import { formatMonth } from '@/lib/format';
import {
  corpStatusBadgeVariant,
  corpStatusLabel,
  currentMonthIST,
  isCorpSpocActionPending,
} from '@/lib/corpFormat';
import { cn } from '@/lib/utils';

const APPROVER_ROLES: UserRole[] = [UserRole.FINANCE_ADMIN, UserRole.CORP_FINANCE_MANAGER];

/** What a Dept SPOC can do with a department's current-month submission. */
function spocAction(row: CorpDepartmentMonthStatus): { label: string; actionable: boolean } {
  if (!row.submissionId) return { label: 'Awaiting cycle open', actionable: false };
  switch (row.status) {
    case CorpSubmissionStatus.DRAFT:
      return { label: 'Continue entry', actionable: true };
    case CorpSubmissionStatus.SENT_BACK_TO_SPOC:
      return { label: 'Revise & resubmit', actionable: true };
    case CorpSubmissionStatus.NOT_STARTED:
      return { label: 'Start entry', actionable: true };
    default:
      return { label: 'View', actionable: true };
  }
}

export function CorporateHome() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isApprover = !!role && APPROVER_ROLES.includes(role);
  const isSpoc = role === UserRole.DEPT_SPOC;
  const month = currentMonthIST();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['corp', 'overview', month],
    queryFn: () => getCorpOverview(month),
  });

  // Only a SPOC owes data entry; the pending emphasis is theirs.
  const pendingCount = isSpoc
    ? rows.filter((r) => !!r.submissionId && isCorpSpocActionPending(r.status)).length
    : 0;

  /** Where a row's action link points — approvers review, everyone else enters/views. */
  const linkFor = (row: CorpDepartmentMonthStatus): string =>
    isApprover
      ? `/corporate/review/${row.submissionId}`
      : `/corporate/submissions/${row.submissionId}`;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Corporate Provisions</h1>
        <p className="text-sm text-muted-foreground">
          {isSpoc
            ? 'Your departments'
            : isApprover
              ? 'All departments'
              : 'Departments'}{' '}
          for {formatMonth(month)}.{' '}
          {isSpoc
            ? 'Enter the monthly provision and submit it for review.'
            : 'Track each department’s submission status for the month.'}
        </p>
      </div>

      {pendingCount > 0 && (
        <AttentionBanner>
          {pendingCount === 1
            ? 'Action needed — 1 department is awaiting your data entry this month.'
            : `Action needed — ${pendingCount} departments are awaiting your data entry this month.`}
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
                <TableHead>Department</TableHead>
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
                    No departments are in your scope.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const pending = isSpoc && !!row.submissionId && isCorpSpocActionPending(row.status);
                  const action = spocAction(row);
                  const linkLabel = isApprover
                    ? row.status === CorpSubmissionStatus.SUBMITTED ||
                      row.status === CorpSubmissionStatus.FINANCE_MANAGER_REVIEW
                      ? 'Review'
                      : 'View'
                    : action.label;
                  return (
                    <TableRow
                      key={row.departmentId}
                      className={cn(pending && attentionAccentClass)}
                    >
                      <TableCell className="font-medium">{row.departmentName}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={corpStatusBadgeVariant(row.status)}>
                            {corpStatusLabel(row.status)}
                          </Badge>
                          {pending && <ActionNeededBadge />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.submissionId && (isApprover || action.actionable) ? (
                          <Button asChild size="sm" variant="outline">
                            <Link to={linkFor(row)}>{linkLabel}</Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {row.submissionId ? linkLabel : 'Awaiting cycle open'}
                          </span>
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
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isActionPending, SubmissionStatus, UserRole } from '@portal/shared';
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
import { getOverview, getQueue } from '@/api/submissions';
import { ClinicApprovedHistory } from '@/components/submissions/ClinicApprovedHistory';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
  PendingCountBadge,
} from '@/components/attention';
import { formatIST, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUEUE_STATUSES = [SubmissionStatus.SUBMITTED, SubmissionStatus.CLINIC_MANAGER_REVIEW];

export function ManagerHome() {
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['submissions', 'queue', 'manager'],
    queryFn: () => getQueue(QUEUE_STATUSES),
  });

  // Full accessible-clinic list (names) for the approved-history section.
  const { data: clinics = [] } = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
  });

  const pendingCount = queue.filter((item) =>
    isActionPending(UserRole.CLINIC_MANAGER, item.status),
  ).length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clinic Manager — Review</h1>
        <p className="text-sm text-muted-foreground">
          Submissions from your clinics awaiting first-level approval.
        </p>
      </div>

      {pendingCount > 0 && (
        <AttentionBanner>
          {pendingCount === 1
            ? 'Action needed — 1 submission is waiting for your approval.'
            : `Action needed — ${pendingCount} submissions are waiting for your approval.`}
        </AttentionBanner>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Review queue</h2>
          <PendingCountBadge count={pendingCount} />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : queue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nothing waiting for review.
                  </TableCell>
                </TableRow>
              ) : (
                queue.map((item) => {
                  const inReview = item.status === SubmissionStatus.CLINIC_MANAGER_REVIEW;
                  const pending = isActionPending(UserRole.CLINIC_MANAGER, item.status);
                  return (
                    <TableRow key={item.id} className={cn(pending && attentionAccentClass)}>
                      <TableCell className="font-medium">{item.clinicName}</TableCell>
                      <TableCell>{formatMonth(item.month)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.submittedAt ? formatIST(item.submittedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={inReview ? 'default' : 'secondary'}>
                            {inReview ? 'In review' : 'Submitted — waiting'}
                          </Badge>
                          {pending && <ActionNeededBadge />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/manager/submissions/${item.id}`}>
                            {inReview ? 'Continue review' : 'Open'}
                          </Link>
                        </Button>
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
        <h2 className="text-sm font-medium text-muted-foreground">Approved history</h2>
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Approved months will appear here.</p>
        ) : (
          clinics.map((clinic) => (
            <ClinicApprovedHistory
              key={clinic.clinicId}
              clinicId={clinic.clinicId}
              clinicName={clinic.clinicName}
              linkBase="/manager/submissions"
            />
          ))
        )}
      </section>
    </div>
  );
}

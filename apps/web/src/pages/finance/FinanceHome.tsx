import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SubmissionStatus } from '@portal/shared';
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
import { formatIST, formatMonth } from '@/lib/format';

const QUEUE_STATUSES = [SubmissionStatus.CLINIC_APPROVED, SubmissionStatus.FINANCE_REVIEW];

export function FinanceHome() {
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['submissions', 'queue', 'finance'],
    queryFn: () => getQueue(QUEUE_STATUSES),
  });
  const { data: clinics = [] } = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Finance — Review &amp; Approval</h1>
        <p className="text-sm text-muted-foreground">
          Clinic-approved submissions awaiting final approval and lock.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Review queue</h2>
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
                    Nothing awaiting finance review.
                  </TableCell>
                </TableRow>
              ) : (
                queue.map((item) => {
                  const inReview = item.status === SubmissionStatus.FINANCE_REVIEW;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.clinicName}</TableCell>
                      <TableCell>{formatMonth(item.month)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.submittedAt ? formatIST(item.submittedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={inReview ? 'default' : 'secondary'}>
                          {inReview ? 'In finance review' : 'Clinic-approved — waiting'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/finance/submissions/${item.id}`}>
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
        <h2 className="text-sm font-medium text-muted-foreground">Approved &amp; locked history</h2>
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Approved months will appear here.</p>
        ) : (
          clinics.map((clinic) => (
            <ClinicApprovedHistory
              key={clinic.clinicId}
              clinicId={clinic.clinicId}
              clinicName={clinic.clinicName}
              linkBase="/finance/submissions"
            />
          ))
        )}
      </section>
    </div>
  );
}

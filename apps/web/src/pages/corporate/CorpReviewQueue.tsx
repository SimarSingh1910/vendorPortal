import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CorpSubmissionStatus } from '@portal/shared';
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
import { getCorpReviewQueue } from '@/api/corpSubmissions';
import {
  ActionNeededBadge,
  attentionAccentClass,
  AttentionBanner,
  PendingCountBadge,
} from '@/components/attention';
import { formatIST, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CorpReviewQueue() {
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['corp', 'queue'],
    queryFn: () => getCorpReviewQueue(),
  });

  // Everything in the queue (SUBMITTED / in-review) is the approver's to action.
  const pendingCount = queue.length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Corporate — Review &amp; Approval</h1>
        <p className="text-sm text-muted-foreground">
          Department submissions awaiting corporate finance approval and lock.
        </p>
      </div>

      {pendingCount > 0 && (
        <AttentionBanner>
          {pendingCount === 1
            ? 'Action needed — 1 submission is waiting for your review.'
            : `Action needed — ${pendingCount} submissions are waiting for your review.`}
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
                <TableHead>Department</TableHead>
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
                    Nothing awaiting corporate review.
                  </TableCell>
                </TableRow>
              ) : (
                queue.map((item) => {
                  const inReview = item.status === CorpSubmissionStatus.FINANCE_MANAGER_REVIEW;
                  return (
                    <TableRow key={item.id} className={cn(attentionAccentClass)}>
                      <TableCell className="font-medium">{item.departmentName}</TableCell>
                      <TableCell>{formatMonth(item.month)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.submittedAt ? formatIST(item.submittedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={inReview ? 'default' : 'secondary'}>
                            {inReview ? 'In finance review' : 'Submitted — waiting'}
                          </Badge>
                          <ActionNeededBadge />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/corporate/review/${item.id}`}>
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
    </div>
  );
}

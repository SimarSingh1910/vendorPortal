import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { SubmissionStatus } from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getComments,
  getSubmission,
  managerApprove,
  managerOpenReview,
  managerSendBack,
} from '@/api/submissions';
import { apiErrorMessage } from '@/lib/apiError';
import { formatINR, formatIST, formatMonth, statusBadgeVariant, statusLabel } from '@/lib/format';

export function ManagerReview() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['submissions', 'detail', submissionId],
    queryFn: () => getSubmission(submissionId),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['submissions', 'comments', submissionId],
    queryFn: () => getComments(submissionId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  // Opening the item moves SUBMITTED → CLINIC_MANAGER_REVIEW (stamps who/when).
  // Fire once; ignore a 409 if it's already in review (e.g. StrictMode re-mount).
  const openedRef = useRef(false);
  useEffect(() => {
    if (!detail || openedRef.current) return;
    if (detail.status === SubmissionStatus.SUBMITTED) {
      openedRef.current = true;
      managerOpenReview(submissionId)
        .then(invalidate)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, submissionId]);

  const approveMutation = useMutation({
    mutationFn: () => managerApprove(submissionId, comment.trim() || undefined),
    onSuccess: () => {
      invalidate();
      navigate('/manager');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not approve. Please try again.')),
  });

  const sendBackMutation = useMutation({
    mutationFn: () => managerSendBack(submissionId, comment.trim()),
    onSuccess: () => {
      invalidate();
      navigate('/manager');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send back. Please try again.')),
  });

  if (isLoading || !detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const inReview = detail.status === SubmissionStatus.CLINIC_MANAGER_REVIEW;
  const busy = approveMutation.isPending || sendBackMutation.isPending;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/manager">
          <ArrowLeft />
          Back to review queue
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.clinicName}</h1>
          <p className="text-sm text-muted-foreground">{formatMonth(detail.month)}</p>
        </div>
        <Badge variant={statusBadgeVariant(detail.status)}>{statusLabel(detail.status)}</Badge>
      </div>

      {detail.reviewStartedAt && (
        <p className="text-xs text-muted-foreground">
          In review since {formatIST(detail.reviewStartedAt)}
          {detail.reviewStartedByName ? ` · opened by ${detail.reviewStartedByName}` : ''}
        </p>
      )}

      {comments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Review history</h2>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {c.commentedBy.name}{' '}
                    <Badge variant={c.action === 'SENT_BACK' ? 'secondary' : 'success'}>
                      {c.action === 'SENT_BACK' ? 'Sent back' : 'Approved'}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatIST(c.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.comment}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Entry data — read only. A manager reviews values but cannot edit them. */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Expense head</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.heads.map((head) => (
              <TableRow key={head.snapshotId}>
                <TableCell className="text-muted-foreground">{head.category}</TableCell>
                <TableCell className="font-medium">{head.name}</TableCell>
                <TableCell className="text-right">{formatINR(head.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {inReview ? (
        <section className="space-y-3">
          <Textarea
            placeholder="Comment (required to send back, optional when approving)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || comment.trim() === ''}
              onClick={() => sendBackMutation.mutate()}
            >
              {sendBackMutation.isPending ? 'Sending back…' : 'Send back'}
            </Button>
            {comment.trim() === '' && (
              <span className="self-center text-xs text-muted-foreground">
                A comment is required to send back.
              </span>
            )}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          This submission is {statusLabel(detail.status).toLowerCase()} — no action available.
        </p>
      )}
    </div>
  );
}

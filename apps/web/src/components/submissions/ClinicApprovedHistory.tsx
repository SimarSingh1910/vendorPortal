import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SubmissionStatus } from '@portal/shared';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getClinicHistory } from '@/api/submissions';
import { formatIST, formatMonth } from '@/lib/format';

/**
 * A clinic's locked (FINANCE_APPROVED) months as read-only links. Shared by the
 * SPOC and Manager homes — `linkBase` controls where "View" navigates.
 */
export function ClinicApprovedHistory({
  clinicId,
  clinicName,
  linkBase,
}: {
  clinicId: string;
  clinicName: string;
  linkBase: string;
}) {
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
                  <Link to={`${linkBase}/${item.id}`}>View (locked)</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

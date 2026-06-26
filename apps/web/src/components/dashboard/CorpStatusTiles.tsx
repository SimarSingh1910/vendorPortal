import type { CorpDashboardStatusTile } from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINR } from '@/lib/format';
import { corpStatusBadgeVariant, corpStatusLabel } from '@/lib/corpFormat';

/**
 * Per-department status tiles for a month — shared by the finance consolidated
 * dashboard (C4.1) and the DEPT_SPOC/VIEWER dashboard (C4.2). The data is already
 * department-scoped by the API, so the same component serves both. `total` is the
 * summed entered amount; null renders "—" via formatINR, never 0.
 */
export function CorpStatusTiles({ tiles }: { tiles: CorpDashboardStatusTile[] }) {
  if (tiles.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No departments in scope.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.departmentId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.departmentName}</CardTitle>
            <CardDescription>
              <Badge variant={corpStatusBadgeVariant(t.status)}>{corpStatusLabel(t.status)}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{formatINR(t.total)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Tabular view of the same status tiles (for the chart/table toggle). */
export function CorpStatusTable({ tiles }: { tiles: CorpDashboardStatusTile[] }) {
  if (tiles.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No departments in scope.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Department</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total entered (₹)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tiles.map((t) => (
          <TableRow key={t.departmentId}>
            <TableCell className="font-medium">{t.departmentName}</TableCell>
            <TableCell>
              <Badge variant={corpStatusBadgeVariant(t.status)}>{corpStatusLabel(t.status)}</Badge>
            </TableCell>
            <TableCell className="text-right">{formatINR(t.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

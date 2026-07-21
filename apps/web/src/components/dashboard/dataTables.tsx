import type {
  ClinicTotalPoint,
  DashboardStatusTile,
  HeadTrendPoint,
  MonthlyTotalPoint,
  VarianceReport,
} from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINR, statusBadgeVariant, statusLabel } from '@/lib/format';
import { deriveHeadChanges, formatSignedINR, formatSignedPct } from '@/lib/headChange';

/** 'YYYY-MM' → 'Jun 26' for compact column headers (matches the chart axis). */
function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

function Empty({ label }: { label: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{label}</p>;
}

/** (a) Submission-status tracker as a table. */
export function StatusTable({ tiles }: { tiles: DashboardStatusTile[] }) {
  if (tiles.length === 0) return <Empty label="No active clinics in scope." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Clinic</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tiles.map((t) => (
          <TableRow key={t.clinicId}>
            <TableCell className="font-medium">{t.clinicName}</TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariant(t.status)}>{statusLabel(t.status)}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {t.total != null ? formatINR(t.total) : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** (b) Month-on-month totals as a table. */
export function MonthlyTotalsTable({ data }: { data: MonthlyTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No expense data for the selected range." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((p) => (
          <TableRow key={p.month}>
            <TableCell className="font-medium">{shortMonth(p.month)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatINR(p.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * (c) Expense-head change over the range: first & last month values, ₹ change,
 * and % change per head, ranked by ₹ change. The tabular companion to the
 * diverging change chart. Heads missing a first- or last-month value can't have
 * a change computed off 0 (NULL ≠ 0), so they're listed separately below.
 */
export function HeadTrendTable({ data }: { data: HeadTrendPoint[] }) {
  if (data.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const { firstMonth, lastMonth, changes, omitted } = deriveHeadChanges(data);
  const rows = [...changes].sort((a, b) => b.absChange - a.absChange);
  const tone = (n: number) => (n >= 0 ? 'text-success-foreground' : 'text-destructive');

  if (rows.length === 0) {
    return <Empty label="No head has a value in both the first and last month of this range." />;
  }

  return (
    <div className="space-y-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Expense head</TableHead>
            <TableHead className="text-right whitespace-nowrap">First ({shortMonth(firstMonth)})</TableHead>
            <TableHead className="text-right whitespace-nowrap">Last ({shortMonth(lastMonth)})</TableHead>
            <TableHead className="text-right whitespace-nowrap">₹ change</TableHead>
            <TableHead className="text-right whitespace-nowrap">% change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(c.firstValue)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(c.lastValue)}</TableCell>
              <TableCell className={`text-right tabular-nums ${tone(c.absChange)}`}>
                {formatSignedINR(c.absChange)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.pctChange == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={tone(c.pctChange)}>{formatSignedPct(c.pctChange)}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {omitted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Omitted (no value in {shortMonth(firstMonth)} or {shortMonth(lastMonth)}):{' '}
          {omitted.map((o) => o.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

/** (d) Clinic-wise totals as a table. */
export function ClinicTotalsTable({ data }: { data: ClinicTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No clinic totals for the selected range." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Clinic</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((c) => (
          <TableRow key={c.clinicId}>
            <TableCell className="font-medium">{c.clinicName}</TableCell>
            <TableCell className="text-right tabular-nums">{formatINR(c.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** (e) Variance as a full table — every head's prior → current and deviation. */
export function VarianceTable({ report }: { report: VarianceReport }) {
  if (report.rows.length === 0) return <Empty label="No variance data for this month." />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Expense head</TableHead>
            <TableHead className="text-right">Prior</TableHead>
            <TableHead className="text-right">YTD avg</TableHead>
            <TableHead className="text-right">Current</TableHead>
            <TableHead className="text-right">Deviation</TableHead>
            <TableHead className="text-right">Flagged</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((r) => (
            <TableRow key={r.expenseHeadId}>
              <TableCell className="font-medium">{r.expenseHeadName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.prior != null ? formatINR(r.prior) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(r.ytdAverage)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(r.current)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.deviationPercent != null ? (
                  `${Number(r.deviationPercent) > 0 ? '+' : ''}${r.deviationPercent}%`
                ) : (
                  <span className="text-muted-foreground">no prior baseline</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {r.flagged ? <Badge variant="secondary">Flagged</Badge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { Fragment } from 'react';
import type {
  ClinicTotalPoint,
  DashboardStatusTile,
  HeadTrendPoint,
  HeadVendorTrendPoint,
  MonthlyTotalPoint,
  VarianceReport,
} from '@portal/shared';
import { reminderKind } from '@portal/shared';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINR, formatIST, statusBadgeVariant, statusLabel } from '@/lib/format';
import { headSplitTotals } from '@/lib/headSplit';

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
export function StatusTable({
  tiles,
  selection,
}: {
  tiles: DashboardStatusTile[];
  /** Finance "Send reminder": tick boxes on the rows that can be reminded. */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
}) {
  if (tiles.length === 0) return <Empty label="No active clinics in scope." />;
  // SPOC / manager names only reach finance viewers (null for clinic users).
  const showPeople = tiles[0].spocNames != null;
  const names = (list: string[] | null) =>
    list?.length ? list.join(', ') : <span className="text-muted-foreground">—</span>;
  const remindable = tiles.flatMap((t) =>
    t.submissionId && reminderKind(t.status) ? [t.submissionId] : [],
  );
  const allTicked = remindable.length > 0 && remindable.every((id) => selection?.selected.has(id));
  const toggle = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selection && (
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all clinics that can be reminded"
                checked={allTicked}
                disabled={remindable.length === 0}
                onChange={() => selection.onChange(allTicked ? new Set() : new Set(remindable))}
              />
            </TableHead>
          )}
          <TableHead>Clinic</TableHead>
          <TableHead>Customer</TableHead>
          {showPeople && <TableHead>Clinic SPOC</TableHead>}
          {showPeople && <TableHead>Cluster manager</TableHead>}
          <TableHead>Status</TableHead>
          {showPeople && <TableHead>Last reminder</TableHead>}
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tiles.map((t) => (
          <TableRow key={t.clinicId}>
            {selection && (
              <TableCell>
                {!t.submissionId ? (
                  <span
                    className="text-muted-foreground"
                    title="Cycle not opened for this month — nothing to remind yet"
                  >
                    —
                  </span>
                ) : (
                  reminderKind(t.status) && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.clinicName} for a reminder`}
                      checked={selection.selected.has(t.submissionId)}
                      onChange={() => toggle(t.submissionId!)}
                    />
                  )
                )}
              </TableCell>
            )}
            <TableCell className="font-medium">{t.clinicName}</TableCell>
            <TableCell>{t.customerName}</TableCell>
            {showPeople && <TableCell>{names(t.spocNames)}</TableCell>}
            {showPeople && <TableCell>{names(t.managerNames)}</TableCell>}
            <TableCell>
              <Badge variant={statusBadgeVariant(t.status)}>{statusLabel(t.status)}</Badge>
            </TableCell>
            {showPeople && (
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {t.lastReminderAt ? (
                  <>
                    <div>{formatIST(t.lastReminderAt)}</div>
                    {t.lastReminderByName && <div>{t.lastReminderByName}</div>}
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
            )}
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

/** (c) Expense-head trends as a pivot table: rows = heads, columns = months. */
export function HeadTrendTable({ data }: { data: HeadTrendPoint[] }) {
  if (data.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const months = [...new Set(data.map((d) => d.month))].sort();
  const heads = [...new Map(data.map((d) => [d.expenseHeadId, d.expenseHeadName])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const value = new Map(data.map((d) => [`${d.expenseHeadId}|${d.month}`, d.total]));
  const colTotal = (month: string) =>
    data.filter((d) => d.month === month).reduce((s, d) => s + Number(d.total), 0);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Expense head</TableHead>
            {months.map((m) => (
              <TableHead key={m} className="text-right whitespace-nowrap">
                {shortMonth(m)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {heads.map(([id, name]) => (
            <TableRow key={id}>
              <TableCell className="font-medium">{name}</TableCell>
              {months.map((m) => {
                const v = value.get(`${id}|${m}`);
                return (
                  <TableCell key={m} className="text-right tabular-nums">
                    {v != null ? formatINR(v) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Total</TableCell>
            {months.map((m) => (
              <TableCell key={m} className="text-right font-semibold tabular-nums">
                {formatINR(colTotal(m).toFixed(2))}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Expense-head split as a table: each head's ₹ total and % share of the range
 * total, ranked largest → smallest (matching the donut). Heads with no data
 * produce no row (NULL ≠ 0) — the same aggregation the chart uses.
 */
export function ExpenseHeadSplitTable({ data }: { data: HeadTrendPoint[] }) {
  const slices = headSplitTotals(data);
  if (slices.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const grand = slices.reduce((s, r) => s + r.total, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Expense head</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slices.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.name}</TableCell>
            <TableCell className="text-right tabular-nums">{formatINR(s.total)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {grand > 0 ? `${((s.total / grand) * 100).toFixed(1)}%` : '—'}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2">
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatINR(grand.toFixed(2))}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">100.0%</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** Sort vendor labels A→Z with the blank ("—") bucket always last. */
function sortVendors(vendors: (string | null)[]): (string | null)[] {
  return [...vendors].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
}

/** The G/L identity cell shown once per group: name over its muted account code. */
function GlHeadCell({ name, no }: { name: string; no: string }) {
  return (
    <div>
      <div className="font-semibold">{name}</div>
      <div className="text-xs font-normal text-muted-foreground">{no}</div>
    </div>
  );
}

/**
 * (c′) Expense-head trend pivot BROKEN DOWN BY VENDOR: rows grouped by G/L, each
 * G/L shown once with its per-month totals, then one indented sub-row per vendor
 * (blank vendor → "—"). A heavier top border separates one G/L group from the
 * next. Columns are months, matching HeadTrendTable. The chart stays head-level.
 */
export function HeadVendorTrendTable({ data }: { data: HeadVendorTrendPoint[] }) {
  if (data.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const months = [...new Set(data.map((d) => d.month))].sort();
  const headMeta = new Map<string, { name: string; no: string }>();
  for (const d of data) headMeta.set(d.expenseHeadId, { name: d.expenseHeadName, no: d.glAccountNo });
  const heads = [...headMeta.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const NULL_KEY = ' ';
  const cell = new Map(
    data.map((d) => [`${d.expenseHeadId}|${d.vendorName ?? NULL_KEY}|${d.month}`, d.total]),
  );
  const headMonth = (id: string, m: string) =>
    data.filter((d) => d.expenseHeadId === id && d.month === m).reduce((s, d) => s + Number(d.total), 0);
  const colTotal = (m: string) =>
    data.filter((d) => d.month === m).reduce((s, d) => s + Number(d.total), 0);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">Expense head / Vendor</TableHead>
            {months.map((m) => (
              <TableHead key={m} className="text-right whitespace-nowrap">
                {shortMonth(m)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {heads.map(([id, meta]) => {
            const vendors = sortVendors([
              ...new Set(data.filter((d) => d.expenseHeadId === id).map((d) => d.vendorName)),
            ]);
            return (
              <Fragment key={id}>
                {/* G/L group header — heavier top border divides groups. */}
                <TableRow className="border-t-2 bg-muted/30">
                  <TableCell>
                    <GlHeadCell name={meta.name} no={meta.no} />
                  </TableCell>
                  {months.map((m) => (
                    <TableCell key={m} className="text-right font-semibold tabular-nums">
                      {formatINR(headMonth(id, m).toFixed(2))}
                    </TableCell>
                  ))}
                </TableRow>
                {vendors.map((v) => (
                  <TableRow key={`${id}|${v ?? NULL_KEY}`} className="border-t-0">
                    <TableCell className="pl-6 text-sm text-muted-foreground">
                      ↳ {v ?? '—'}
                    </TableCell>
                    {months.map((m) => {
                      const val = cell.get(`${id}|${v ?? NULL_KEY}|${m}`);
                      return (
                        <TableCell key={m} className="text-right tabular-nums">
                          {val != null ? formatINR(val) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Total</TableCell>
            {months.map((m) => (
              <TableCell key={m} className="text-right font-semibold tabular-nums">
                {formatINR(colTotal(m).toFixed(2))}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * (d′) Expense-head split BROKEN DOWN BY VENDOR: each G/L (ranked by total, like
 * the donut) shown once with its ₹ total and % share, then one indented sub-row
 * per vendor (blank vendor → "—") with its own ₹ and % of the grand total — so a
 * head's vendor shares sum to the head's share. A heavier top border divides
 * G/L groups.
 */
export function ExpenseHeadVendorSplitTable({ data }: { data: HeadVendorTrendPoint[] }) {
  const heads = new Map<
    string,
    { name: string; no: string; total: number; vendors: Map<string | null, number> }
  >();
  for (const d of data) {
    const h =
      heads.get(d.expenseHeadId) ??
      { name: d.expenseHeadName, no: d.glAccountNo, total: 0, vendors: new Map() };
    h.total += Number(d.total);
    h.vendors.set(d.vendorName, (h.vendors.get(d.vendorName) ?? 0) + Number(d.total));
    heads.set(d.expenseHeadId, h);
  }
  const list = [...heads.values()].sort((a, b) => b.total - a.total);
  if (list.length === 0) return <Empty label="No expense-head data for the selected range." />;
  const grand = list.reduce((s, h) => s + h.total, 0);
  const pct = (n: number) => (grand > 0 ? `${((n / grand) * 100).toFixed(1)}%` : '—');

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Expense head / Vendor</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((h) => (
          <Fragment key={h.no}>
            <TableRow className="border-t-2 bg-muted/30">
              <TableCell>
                <GlHeadCell name={h.name} no={h.no} />
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatINR(h.total.toFixed(2))}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{pct(h.total)}</TableCell>
            </TableRow>
            {sortVendors([...h.vendors.keys()]).map((v) => (
              <TableRow key={`${h.no}|${v ?? ' '}`} className="border-t-0">
                <TableCell className="pl-6 text-sm text-muted-foreground">↳ {v ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR((h.vendors.get(v) ?? 0).toFixed(2))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(h.vendors.get(v) ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
        <TableRow className="border-t-2">
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatINR(grand.toFixed(2))}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">100.0%</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** (d) Clinic-wise totals as a table. */
export function ClinicTotalsTable({ data }: { data: ClinicTotalPoint[] }) {
  if (data.length === 0) return <Empty label="No clinic totals for the selected range." />;
  return (
    // Same cap as the chart half of this card (see ClinicTotalsChart): one row per
    // clinic grows without limit, so flipping to Table must not undo the height the
    // chart view just respected.
    <div className="max-h-96 overflow-y-auto">
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
    </div>
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

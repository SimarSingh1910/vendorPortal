import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  SubmissionStatus,
  type DashboardStatusTile,
  type MonthlyTotalPoint,
  type VarianceReport,
} from '@portal/shared';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Compact en-IN money: ₹1.21 Cr / ₹71.4 L / ₹8.3 k. NULL-safe (returns "—"). */
function compactINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)} k`;
  return `₹${Math.round(n)}`;
}

/** 'YYYY-MM' → 'Jul'. */
function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Signed percent pill with an up/down arrow; tone follows the direction. */
function DeltaPill({ pct, caption }: { pct: number | null; caption: string }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className="text-xs text-muted-foreground">{caption}</span>;
  }
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
          up ? 'bg-warning text-warning-foreground' : 'bg-success text-success-foreground',
        )}
      >
        {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
        {up ? '+' : '−'}
        {Math.abs(pct).toFixed(1)}%
      </span>
      <span className="text-muted-foreground">{caption}</span>
    </span>
  );
}

/** Tiny area sparkline (no axes) for the KPI headline trend. */
function Sparkline({ values, color = '#0F6CB6' }: { values: number[]; color?: string }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <div className="h-10" />;
  const w = 200;
  const h = 40;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 4) - 2;
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      {children}
    </Card>
  );
}

/** Sum monthly totals over an inclusive [from, to] YYYY-MM window (present months only). */
function sumMonths(monthly: MonthlyTotalPoint[], from: string, to: string): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const p of monthly) {
    if (p.month >= from && p.month <= to) {
      sum += Number(p.total);
      count += 1;
    }
  }
  return { sum, count };
}

/** Shift a YYYY-MM month by delta months. */
function shift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * KPI headline row: current-month provision (with MoM%), FY-to-date provision
 * (with vs-prior-period%), flagged-head count, and awaiting-approval total.
 * All derived client-side from data the dashboard already loaded.
 */
export function KpiRow({
  monthly,
  tiles,
  variance,
  asOf,
}: {
  monthly: MonthlyTotalPoint[];
  tiles: DashboardStatusTile[];
  variance: VarianceReport | undefined;
  asOf: string;
}) {
  const sorted = [...monthly].sort((a, b) => a.month.localeCompare(b.month));
  const series = sorted.map((p) => Number(p.total));
  const current = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const momPct =
    current && prev && Number(prev.total) !== 0
      ? ((Number(current.total) - Number(prev.total)) / Number(prev.total)) * 100
      : null;

  // FY-to-date (India FY starts April). Sum the months from FY-start to asOf, and
  // compare against the equal-length window immediately before FY-start.
  const [ay, am] = asOf.split('-').map(Number);
  const fyStart = `${am >= 4 ? ay : ay - 1}-04`;
  const ytd = sumMonths(monthly, fyStart, asOf);
  const priorFrom = shift(fyStart, -ytd.count);
  const priorTo = shift(fyStart, -1);
  const priorPeriod = sumMonths(monthly, priorFrom, priorTo);
  const ytdPct =
    priorPeriod.count === ytd.count && priorPeriod.sum !== 0
      ? ((ytd.sum - priorPeriod.sum) / priorPeriod.sum) * 100
      : null;

  const flaggedRows = variance?.rows.filter((r) => r.flagged) ?? [];
  const totalRows = variance?.rows.length ?? 0;
  const threshold = variance?.thresholdPercent;

  // Awaiting = clinics not yet finance-approved; ₹ = sum of their (non-null) totals.
  const pending = tiles.filter((t) => t.status !== SubmissionStatus.FINANCE_APPROVED);
  const pendingTotal = pending.reduce((s, t) => s + (t.total != null ? Number(t.total) : 0), 0);
  const approvedCount = tiles.length - pending.length;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={`Total Provision · ${current ? monthShort(current.month) : '—'}`}
        value={compactINR(current ? Number(current.total) : null)}
      >
        <DeltaPill pct={momPct} caption={prev ? `vs ${monthShort(prev.month)}` : 'no prior month'} />
        <Sparkline values={series} />
      </KpiCard>

      <KpiCard label="Provision YTD" value={compactINR(ytd.count ? ytd.sum : null)}>
        <DeltaPill pct={ytdPct} caption="vs prior period" />
        <Sparkline values={series} color="#5A7C9C" />
      </KpiCard>

      <KpiCard
        label="Flagged Heads"
        value={
          <span>
            {flaggedRows.length} <span className="text-base font-medium text-muted-foreground">of {totalRows}</span>
          </span>
        }
      >
        <p className="text-xs text-muted-foreground">
          {threshold != null ? `beyond ±${threshold}% MoM` : 'no threshold set'}
        </p>
        {totalRows > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {variance!.rows.map((r) => (
              <span
                key={r.expenseHeadId}
                title={r.expenseHeadName}
                className={cn('size-2 rounded-full', r.flagged ? 'bg-destructive' : 'bg-border')}
              />
            ))}
          </div>
        )}
      </KpiCard>

      <KpiCard label="Awaiting Approval" value={compactINR(pendingTotal)}>
        <p className="text-xs text-muted-foreground">
          {pending.length} clinic{pending.length === 1 ? '' : 's'} pending
        </p>
        {tiles.length > 0 && (
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-border">
            <div
              className="bg-success"
              style={{ width: `${(approvedCount / tiles.length) * 100}%` }}
            />
            <div
              className="bg-warning"
              style={{ width: `${(pending.length / tiles.length) * 100}%` }}
            />
          </div>
        )}
      </KpiCard>
    </div>
  );
}

// ── Submission pipeline ──────────────────────────────────────────────────────

type Bucket = 'notStarted' | 'draft' | 'submitted' | 'inReview' | 'sentBack' | 'approved';

const BUCKETS: Array<{ key: Bucket; label: string; color: string }> = [
  { key: 'notStarted', label: 'Not started', color: '#E3E8F0' },
  { key: 'draft', label: 'Draft', color: '#CBD5E1' },
  { key: 'submitted', label: 'Submitted', color: '#8FB3C9' },
  { key: 'inReview', label: 'In review', color: '#FBC04A' },
  { key: 'sentBack', label: 'Sent back', color: '#D9636F' },
  { key: 'approved', label: 'Approved', color: '#8FC7A6' },
];

function bucketOf(status: SubmissionStatus): Bucket {
  switch (status) {
    case SubmissionStatus.NOT_STARTED:
      return 'notStarted';
    case SubmissionStatus.DRAFT:
      return 'draft';
    case SubmissionStatus.SUBMITTED:
      return 'submitted';
    case SubmissionStatus.CLINIC_MANAGER_REVIEW:
    case SubmissionStatus.CLINIC_APPROVED:
    case SubmissionStatus.FINANCE_REVIEW:
      return 'inReview';
    case SubmissionStatus.SENT_BACK_BY_MANAGER:
    case SubmissionStatus.SENT_BACK_BY_FINANCE:
      return 'sentBack';
    case SubmissionStatus.FINANCE_APPROVED:
      return 'approved';
  }
}

/**
 * Submission pipeline: a stacked status bar across all clinics for the month,
 * with a per-bucket count legend. "Reported" counts clinics past Not-started.
 */
export function SubmissionPipeline({ tiles }: { tiles: DashboardStatusTile[] }) {
  const counts = new Map<Bucket, number>();
  for (const t of tiles) counts.set(bucketOf(t.status), (counts.get(bucketOf(t.status)) ?? 0) + 1);
  const total = tiles.length;
  const reported = tiles.filter((t) => t.status !== SubmissionStatus.NOT_STARTED).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {total} clinic{total === 1 ? '' : 's'} · {reported} reported.
      </p>
      <div className="flex h-3 overflow-hidden rounded-full bg-border">
        {BUCKETS.map((b) => {
          const c = counts.get(b.key) ?? 0;
          if (!c || !total) return null;
          return (
            <div
              key={b.key}
              style={{ width: `${(c / total) * 100}%`, backgroundColor: b.color }}
              title={`${b.label}: ${c}`}
            />
          );
        })}
      </div>
      <ul className="space-y-2">
        {BUCKETS.map((b) => (
          <li key={b.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: b.color }} />
              <span>{b.label}</span>
            </span>
            <span className="font-medium tabular-nums">{counts.get(b.key) ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

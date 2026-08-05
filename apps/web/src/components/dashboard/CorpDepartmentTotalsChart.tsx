import type { CorpDepartmentTotalPoint } from '@portal/shared';
import { CHART_ANCHOR } from '@/lib/chartColors';

/** Compact INR for the value column (₹1.2 L / ₹3.4 Cr). */
function compactINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)} k`;
  return `₹${Math.round(n)}`;
}

/**
 * (d) Cross-department totals over the range: a ranked list of track bars with
 * each department's total and its share of the grand total. The corporate
 * analogue of the clinic-wise chart; the top department is highlighted and bar
 * length is relative to it.
 */
export function CorpDepartmentTotalsChart({ data }: { data: CorpDepartmentTotalPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No department totals for the selected range.
      </p>
    );
  }
  const rows = data
    .map((d) => ({ name: d.departmentName, total: Number(d.total) }))
    .sort((a, b) => b.total - a.total);
  const grand = rows.reduce((s, r) => s + r.total, 0);
  const max = rows[0]?.total || 1;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3 text-sm">
          {/* Same fixed-width clipping as the clinic-wise chart — full name on hover. */}
          <span
            className="w-40 shrink-0 truncate text-right text-muted-foreground"
            title={r.name}
          >
            {r.name}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded"
              style={{
                width: `${max > 0 ? (r.total / max) * 100 : 0}%`,
                backgroundColor: CHART_ANCHOR,
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right font-mono tabular-nums">{compactINR(r.total)}</span>
          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
            {grand > 0 ? `${((r.total / grand) * 100).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

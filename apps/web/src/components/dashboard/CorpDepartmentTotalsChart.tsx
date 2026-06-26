import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CorpDepartmentTotalPoint } from '@portal/shared';
import { formatINR } from '@/lib/format';
import { colorByIndex } from '@/lib/chartColors';

/** Compact INR for the X-axis ticks (₹1.2L / ₹3.4Cr) — mirrors charts.tsx. */
function compactINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n}`;
}

/**
 * (d) Cross-department totals over the range, as horizontal bars. The corporate
 * analogue of clinic `ClinicTotalsChart` — same layout, keyed on department name.
 */
export function CorpDepartmentTotalsChart({ data }: { data: CorpDepartmentTotalPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No department totals for the selected range.
      </p>
    );
  }
  const rows = data.map((d) => ({ department: d.departmentName, total: Number(d.total) }));
  return (
    <div className="w-full" style={{ height: Math.max(180, rows.length * 40 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={compactINR} fontSize={12} />
          <YAxis type="category" dataKey="department" width={160} fontSize={12} />
          <Tooltip formatter={(v: number | string) => formatINR(v as number)} />
          <Bar dataKey="total" name="Total" fill={colorByIndex(1)} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

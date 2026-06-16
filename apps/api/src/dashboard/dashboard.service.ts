import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SubmissionStatus,
  type ClinicTotalPoint,
  type DashboardFilterOptions,
  type DashboardStatusTile,
  type HeadTrendPoint,
  type MonthlyTotalPoint,
  type VarianceReport,
  type VarianceRow,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { currentMonthIST } from '../submissions/month.util';
import type { RequestUser } from '../auth/request-user';

/** Default trend window when the caller gives no range: the last 12 months. */
const DEFAULT_RANGE_MONTHS = 12;

/** Shift a YYYY-MM month by `delta` months (handles year rollover). */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface DashboardFilters {
  clinicId?: string;
  expenseHeadId?: string;
  from?: string;
  to?: string;
  month?: string;
  // Matches the DTO/web field name (an array despite the singular).
  status?: SubmissionStatus[];
}

/**
 * Finance/clinic analytics (FR-07, Phase 11). Every figure is computed with a
 * single aggregated SQL GROUP BY (parameterized $queryRaw) over the provision
 * data — never per-row fetches — to stay well under the 3s target. Results are
 * always clinic-scoped: finance roles see every clinic, clinic roles only their
 * assigned clinics, so the SAME endpoints serve the finance central dashboard
 * (11.1) and the SPOC/Manager dashboard (11.2).
 *
 * Money is summed as DECIMAL(14,2) and returned as a fixed-scale string (CAST AS
 * CHAR), consistent with the rest of the API's decimal-as-string convention.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
  ) {}

  /** Accessible clinic ids, narrowed to a single clinic when one is requested. */
  private async resolveClinicIds(user: RequestUser, clinicId?: string): Promise<string[]> {
    const accessible = await this.scope.accessibleClinicIds(user);
    if (!clinicId) return accessible;
    return accessible.includes(clinicId) ? [clinicId] : [];
  }

  /** Resolve the trend range, defaulting to the last DEFAULT_RANGE_MONTHS months. */
  private resolveRange(filters: DashboardFilters): { from: string; to: string } {
    const to = filters.to ?? filters.month ?? currentMonthIST();
    const from = filters.from ?? shiftMonth(to, -(DEFAULT_RANGE_MONTHS - 1));
    return { from, to };
  }

  /**
   * WHERE clause for the entry-based aggregations. All queries alias the joined
   * tables as p(rovisionentry) / s(napshot) / m(onthlysubmission), so the
   * fragments compose. Assumes a non-empty clinicIds (callers guard).
   */
  private entryWhere(
    clinicIds: string[],
    opts: { from?: string; to?: string; month?: string; expenseHeadId?: string; statuses?: SubmissionStatus[] },
  ): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`m.clinicId IN (${Prisma.join(clinicIds)})`];
    if (opts.month) conds.push(Prisma.sql`m.month = ${opts.month}`);
    if (opts.from) conds.push(Prisma.sql`m.month >= ${opts.from}`);
    if (opts.to) conds.push(Prisma.sql`m.month <= ${opts.to}`);
    if (opts.expenseHeadId) conds.push(Prisma.sql`s.expenseHeadId = ${opts.expenseHeadId}`);
    if (opts.statuses?.length) conds.push(Prisma.sql`m.status IN (${Prisma.join(opts.statuses)})`);
    return Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
  }

  // ── (a) Current-month submission-status tracker ─────────────────────────────
  async statusTracker(user: RequestUser, month?: string): Promise<DashboardStatusTile[]> {
    const m = month ?? currentMonthIST();
    const clinicIds = await this.resolveClinicIds(user);
    if (clinicIds.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      Array<{ clinicId: string; clinicName: string; submissionId: string | null; status: string | null; total: string | null }>
    >(Prisma.sql`
      SELECT c.id AS clinicId, c.name AS clinicName, m.id AS submissionId,
             m.status AS status, CAST(SUM(p.amount) AS CHAR) AS total
      FROM clinic c
      LEFT JOIN monthlysubmission m ON m.clinicId = c.id AND m.month = ${m}
      LEFT JOIN provisionentry p ON p.submissionId = m.id
      WHERE c.isActive = 1 AND c.id IN (${Prisma.join(clinicIds)})
      GROUP BY c.id, c.name, m.id, m.status
      ORDER BY c.name ASC
    `);

    return rows.map((r) => ({
      clinicId: r.clinicId,
      clinicName: r.clinicName,
      month: m,
      status: (r.status ?? SubmissionStatus.NOT_STARTED) as SubmissionStatus,
      submissionId: r.submissionId ?? null,
      total: r.total != null ? String(r.total) : null,
    }));
  }

  // ── (b) Month-on-month expense comparison ───────────────────────────────────
  async monthlyTotals(user: RequestUser, filters: DashboardFilters): Promise<MonthlyTotalPoint[]> {
    const clinicIds = await this.resolveClinicIds(user, filters.clinicId);
    if (clinicIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<Array<{ month: string; total: string }>>(Prisma.sql`
      SELECT m.month AS month, CAST(SUM(p.amount) AS CHAR) AS total
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      ${this.entryWhere(clinicIds, { from, to, expenseHeadId: filters.expenseHeadId, statuses: filters.status })}
      GROUP BY m.month
      ORDER BY m.month ASC
    `);
    return rows.map((r) => ({ month: r.month, total: String(r.total) }));
  }

  // ── (c) Expense-head-wise trends ────────────────────────────────────────────
  async headTrends(user: RequestUser, filters: DashboardFilters): Promise<HeadTrendPoint[]> {
    const clinicIds = await this.resolveClinicIds(user, filters.clinicId);
    if (clinicIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; expenseHeadId: string; expenseHeadName: string; total: string }>
    >(Prisma.sql`
      SELECT m.month AS month, s.expenseHeadId AS expenseHeadId,
             MAX(e.name) AS expenseHeadName, CAST(SUM(p.amount) AS CHAR) AS total
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN expensehead e ON e.id = s.expenseHeadId
      ${this.entryWhere(clinicIds, { from, to, expenseHeadId: filters.expenseHeadId, statuses: filters.status })}
      GROUP BY m.month, s.expenseHeadId
      ORDER BY m.month ASC, expenseHeadName ASC
    `);
    return rows.map((r) => ({
      month: r.month,
      expenseHeadId: r.expenseHeadId,
      expenseHeadName: r.expenseHeadName,
      total: String(r.total),
    }));
  }

  // ── (d) Clinic-wise total comparison over a month range ─────────────────────
  async clinicTotals(user: RequestUser, filters: DashboardFilters): Promise<ClinicTotalPoint[]> {
    const clinicIds = await this.resolveClinicIds(user, filters.clinicId);
    if (clinicIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<
      Array<{ clinicId: string; clinicName: string; total: string }>
    >(Prisma.sql`
      SELECT m.clinicId AS clinicId, MAX(c.name) AS clinicName, CAST(SUM(p.amount) AS CHAR) AS total
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN clinic c ON c.id = m.clinicId
      ${this.entryWhere(clinicIds, { from, to, expenseHeadId: filters.expenseHeadId, statuses: filters.status })}
      GROUP BY m.clinicId
      ORDER BY SUM(p.amount) DESC
    `);
    return rows.map((r) => ({ clinicId: r.clinicId, clinicName: r.clinicName, total: String(r.total) }));
  }

  // ── (e) Variance alerts (BR-12) ─────────────────────────────────────────────
  async variance(user: RequestUser, month?: string, clinicId?: string): Promise<VarianceReport> {
    const m = month ?? currentMonthIST();
    const priorMonth = shiftMonth(m, -1);
    const clinicIds = await this.resolveClinicIds(user, clinicId);

    const config = await this.prisma.notificationConfig.findUnique({ where: { month: m } });
    const thresholdPercent = config ? config.varianceThresholdPercent.toFixed(2) : null;
    const thresholdNum = thresholdPercent != null ? Number(thresholdPercent) : null;

    if (clinicIds.length === 0) {
      return { month: m, priorMonth, thresholdPercent, rows: [] };
    }

    const [current, prior] = await Promise.all([
      this.headTotalsForMonth(clinicIds, m),
      this.headTotalsForMonth(clinicIds, priorMonth),
    ]);

    const headIds = new Set<string>([...current.keys(), ...prior.keys()]);
    const rows: VarianceRow[] = [];
    for (const id of headIds) {
      const cur = current.get(id);
      const pri = prior.get(id);
      const name = cur?.name ?? pri?.name ?? id;
      const curNum = cur ? Number(cur.total) : 0;
      const priNum = pri ? Number(pri.total) : null;

      let deviationPercent: string | null = null;
      let flagged = false;
      if (priNum !== null && priNum !== 0) {
        const dev = ((curNum - priNum) / priNum) * 100;
        deviationPercent = dev.toFixed(2);
        flagged = thresholdNum !== null && Math.abs(dev) > thresholdNum;
      } else {
        // No prior baseline (head absent or prior total 0): any new spend is a
        // breach when a threshold is set.
        flagged = thresholdNum !== null && curNum > 0;
      }

      rows.push({
        expenseHeadId: id,
        expenseHeadName: name,
        current: curNum.toFixed(2),
        prior: pri ? String(pri.total) : null,
        deviationPercent,
        flagged,
      });
    }

    // Flagged first, then largest movement, then name — alerts surface at the top.
    rows.sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      const da = a.deviationPercent != null ? Math.abs(Number(a.deviationPercent)) : Infinity;
      const db = b.deviationPercent != null ? Math.abs(Number(b.deviationPercent)) : Infinity;
      if (da !== db) return db - da;
      return a.expenseHeadName.localeCompare(b.expenseHeadName);
    });

    return { month: m, priorMonth, thresholdPercent, rows };
  }

  private async headTotalsForMonth(
    clinicIds: string[],
    month: string,
  ): Promise<Map<string, { name: string; total: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ expenseHeadId: string; expenseHeadName: string; total: string }>
    >(Prisma.sql`
      SELECT s.expenseHeadId AS expenseHeadId, MAX(e.name) AS expenseHeadName,
             CAST(SUM(p.amount) AS CHAR) AS total
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN expensehead e ON e.id = s.expenseHeadId
      WHERE m.clinicId IN (${Prisma.join(clinicIds)}) AND m.month = ${month}
      GROUP BY s.expenseHeadId
    `);
    return new Map(rows.map((r) => [r.expenseHeadId, { name: r.expenseHeadName, total: String(r.total) }]));
  }

  // ── Filter dropdown options (scoped) ────────────────────────────────────────
  async filterOptions(user: RequestUser): Promise<DashboardFilterOptions> {
    const clinicIds = await this.scope.accessibleClinicIds(user);
    const [clinics, expenseHeads] = await Promise.all([
      clinicIds.length
        ? this.prisma.clinic.findMany({
            where: { id: { in: clinicIds } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.expenseHead.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { clinics, expenseHeads };
  }
}

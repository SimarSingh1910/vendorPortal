import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CorpDepartmentType,
  CorpSubmissionStatus,
  type CorpDashboardFilterOptions,
  type CorpDashboardStatusTile,
  type CorpDeptMonthlyTotalPoint,
  type CorpDepartmentTotalPoint,
  type CorpHeadTrendPoint,
  type CorpMonthlyTotalPoint,
  type CorpSec24MonthPoint,
  type VarianceReport,
  type VarianceRow,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { currentMonthIST } from '../submissions/month.util';
import type { RequestUser } from '../auth/request-user';

const DEFAULT_RANGE_MONTHS = 12;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** April of the fiscal year containing `month` (India FY = Apr–Mar). */
function fiscalYearStart(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04`;
}

function monthsBetweenInclusive(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

interface CorpDashboardFilters {
  departmentId?: string;
  expenseHeadId?: string;
  budgetCodeId?: string;
  from?: string;
  to?: string;
  month?: string;
  status?: CorpSubmissionStatus[];
}

/**
 * Corporate finance analytics (Step C4.1). A PRESENTATION/READ layer: it DISPLAYS
 * already-computed corporate data and never recomputes or mutates it.
 *
 *  - Every figure is one aggregated SQL GROUP BY (parameterized $queryRaw) over
 *    the corporate provision data — never per-row fetches — to stay under the 3s
 *    target.
 *  - Sec 24 is read from FROZEN values only: the per-line hclAvitasShare and the
 *    per-submission sec24PctSnapshot, as-is. The dashboard NEVER recomputes
 *    share = amount × %. NULL ≠ 0: a null share/% renders "—", never 0 — SUM()
 *    skips nulls (a null contributes nothing) but a column that is entirely null
 *    stays null rather than collapsing to 0.
 *  - Department-scoped via CorpDepartmentScopeService: approvers/admin see all
 *    departments, DEPT_SPOC/VIEWER only their assigned ones.
 *  - READS ONLY: no audit rows, no state changes.
 *
 * Money is summed as DECIMAL(14,2) and returned as a fixed-scale string (CAST AS
 * CHAR), consistent with the rest of the API's decimal-as-string convention.
 */
@Injectable()
export class CorpDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
  ) {}

  /** Accessible department ids, narrowed to one when requested (empty = no access). */
  private async resolveDepartmentIds(user: RequestUser, departmentId?: string): Promise<string[]> {
    const accessible = await this.scope.accessibleDepartmentIds(user);
    if (!departmentId) return accessible;
    return accessible.includes(departmentId) ? [departmentId] : [];
  }

  private resolveRange(filters: CorpDashboardFilters): { from: string; to: string } {
    const to = filters.to ?? filters.month ?? currentMonthIST();
    const from = filters.from ?? shiftMonth(to, -(DEFAULT_RANGE_MONTHS - 1));
    return { from, to };
  }

  /**
   * WHERE clause for the entry-based aggregations. Tables are aliased
   * p(corp_provision_entries) / s(corp_submission_expense_head_snapshots) /
   * m(corp_monthly_submissions). Assumes a non-empty departmentIds (callers guard).
   */
  private entryWhere(
    departmentIds: string[],
    opts: {
      from?: string;
      to?: string;
      month?: string;
      expenseHeadId?: string;
      budgetCodeId?: string;
      statuses?: CorpSubmissionStatus[];
    },
  ): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`m.departmentId IN (${Prisma.join(departmentIds)})`];
    if (opts.month) conds.push(Prisma.sql`m.month = ${opts.month}`);
    if (opts.from) conds.push(Prisma.sql`m.month >= ${opts.from}`);
    if (opts.to) conds.push(Prisma.sql`m.month <= ${opts.to}`);
    if (opts.expenseHeadId) conds.push(Prisma.sql`s.expenseHeadId = ${opts.expenseHeadId}`);
    if (opts.budgetCodeId) conds.push(Prisma.sql`p.budgetCodeId = ${opts.budgetCodeId}`);
    if (opts.statuses?.length) conds.push(Prisma.sql`m.status IN (${Prisma.join(opts.statuses)})`);
    return Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
  }

  // ── (a) Current-month status tracker ────────────────────────────────────────
  async statusTracker(user: RequestUser, month?: string): Promise<CorpDashboardStatusTile[]> {
    const m = month ?? currentMonthIST();
    const departmentIds = await this.resolveDepartmentIds(user);
    if (departmentIds.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      Array<{
        departmentId: string;
        departmentName: string;
        submissionId: string | null;
        status: string | null;
        total: string | null;
      }>
    >(Prisma.sql`
      SELECT d.id AS departmentId, d.name AS departmentName, m.id AS submissionId,
             m.status AS status, CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_departments d
      LEFT JOIN corp_monthly_submissions m ON m.departmentId = d.id AND m.month = ${m}
      LEFT JOIN corp_provision_entries p ON p.submissionId = m.id
      WHERE d.isActive = 1 AND d.id IN (${Prisma.join(departmentIds)})
      GROUP BY d.id, d.name, m.id, m.status
      ORDER BY d.name ASC
    `);

    return rows.map((r) => ({
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      month: m,
      status: (r.status ?? CorpSubmissionStatus.NOT_STARTED) as CorpSubmissionStatus,
      submissionId: r.submissionId ?? null,
      total: r.total != null ? String(r.total) : null,
    }));
  }

  // ── (b) Month-on-month — combined ───────────────────────────────────────────
  async monthlyTotals(
    user: RequestUser,
    filters: CorpDashboardFilters,
  ): Promise<CorpMonthlyTotalPoint[]> {
    const departmentIds = await this.resolveDepartmentIds(user, filters.departmentId);
    if (departmentIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<Array<{ month: string; total: string }>>(Prisma.sql`
      SELECT m.month AS month, CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      ${this.entryWhere(departmentIds, { from, to, expenseHeadId: filters.expenseHeadId, budgetCodeId: filters.budgetCodeId, statuses: filters.status })}
      GROUP BY m.month
      ORDER BY m.month ASC
    `);
    return rows.map((r) => ({ month: r.month, total: String(r.total) }));
  }

  // ── (b') Month-on-month — per department ────────────────────────────────────
  async departmentMonthlyTotals(
    user: RequestUser,
    filters: CorpDashboardFilters,
  ): Promise<CorpDeptMonthlyTotalPoint[]> {
    const departmentIds = await this.resolveDepartmentIds(user, filters.departmentId);
    if (departmentIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; departmentId: string; departmentName: string; total: string }>
    >(Prisma.sql`
      SELECT m.month AS month, m.departmentId AS departmentId,
             MAX(d.name) AS departmentName, CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      JOIN corp_departments d ON d.id = m.departmentId
      ${this.entryWhere(departmentIds, { from, to, expenseHeadId: filters.expenseHeadId, budgetCodeId: filters.budgetCodeId, statuses: filters.status })}
      GROUP BY m.month, m.departmentId
      ORDER BY m.month ASC, departmentName ASC
    `);
    return rows.map((r) => ({
      month: r.month,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      total: String(r.total),
    }));
  }

  // ── (c) Expense-head drill-down ─────────────────────────────────────────────
  async headTrends(
    user: RequestUser,
    filters: CorpDashboardFilters,
  ): Promise<CorpHeadTrendPoint[]> {
    const departmentIds = await this.resolveDepartmentIds(user, filters.departmentId);
    if (departmentIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; expenseHeadId: string; expenseHeadName: string; total: string }>
    >(Prisma.sql`
      SELECT m.month AS month, s.expenseHeadId AS expenseHeadId,
             MAX(s.expenseHeadNameAtSnapshot) AS expenseHeadName, CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      ${this.entryWhere(departmentIds, { from, to, expenseHeadId: filters.expenseHeadId, budgetCodeId: filters.budgetCodeId, statuses: filters.status })}
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

  // ── (d) Cross-department totals over a range ────────────────────────────────
  async departmentTotals(
    user: RequestUser,
    filters: CorpDashboardFilters,
  ): Promise<CorpDepartmentTotalPoint[]> {
    const departmentIds = await this.resolveDepartmentIds(user, filters.departmentId);
    if (departmentIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    const rows = await this.prisma.$queryRaw<
      Array<{ departmentId: string; departmentName: string; total: string }>
    >(Prisma.sql`
      SELECT m.departmentId AS departmentId, MAX(d.name) AS departmentName,
             CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      JOIN corp_departments d ON d.id = m.departmentId
      ${this.entryWhere(departmentIds, { from, to, expenseHeadId: filters.expenseHeadId, budgetCodeId: filters.budgetCodeId, statuses: filters.status })}
      GROUP BY m.departmentId
      ORDER BY SUM(p.amount) DESC
    `);
    return rows.map((r) => ({
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      total: String(r.total),
    }));
  }

  // ── (f) Sec 24 dual display — total | HCL share | % used (FROZEN values) ─────
  async sec24Dual(user: RequestUser, filters: CorpDashboardFilters): Promise<CorpSec24MonthPoint[]> {
    const departmentIds = await this.resolveDepartmentIds(user, filters.departmentId);
    if (departmentIds.length === 0) return [];
    const { from, to } = this.resolveRange(filters);

    // Read frozen values only: SUM(p.hclAvitasShare) skips nulls and stays NULL
    // when nothing is frozen yet (→ "—", never 0); the % used is the submission's
    // sec24PctSnapshot (NULL until approved-with-%). Share is NEVER recomputed.
    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; total: string | null; hclShare: string | null; pct: string | null }>
    >(Prisma.sql`
      SELECT m.month AS month,
             CAST(SUM(p.amount) AS CHAR) AS total,
             CAST(SUM(p.hclAvitasShare) AS CHAR) AS hclShare,
             CAST(MAX(m.sec24PctSnapshot) AS CHAR) AS pct
      FROM corp_monthly_submissions m
      JOIN corp_departments d ON d.id = m.departmentId AND d.type = ${CorpDepartmentType.SHARED_COST_POOL}
      LEFT JOIN corp_provision_entries p ON p.submissionId = m.id
      WHERE m.departmentId IN (${Prisma.join(departmentIds)}) AND m.month >= ${from} AND m.month <= ${to}
      GROUP BY m.month
      ORDER BY m.month ASC
    `);

    return rows.map((r) => ({
      month: r.month,
      total: r.total != null ? String(r.total) : null,
      // Preserve NULL (no frozen share / no % set) — do NOT coalesce to 0.
      hclAvitasShare: r.hclShare != null ? String(r.hclShare) : null,
      allocationPct: r.pct != null ? String(r.pct) : null,
    }));
  }

  // ── (e) Variance alerts vs prior month at the CONFIGURABLE threshold ─────────
  async variance(user: RequestUser, month?: string, departmentId?: string): Promise<VarianceReport> {
    const m = month ?? currentMonthIST();
    const priorMonth = shiftMonth(m, -1);
    const departmentIds = await this.resolveDepartmentIds(user, departmentId);

    // Threshold comes from the shared per-month NotificationConfig (BR-12) —
    // never hardcoded; null when none is configured for the month.
    const config = await this.prisma.notificationConfig.findUnique({ where: { month: m } });
    const thresholdPercent = config ? config.varianceThresholdPercent.toFixed(2) : null;
    const thresholdNum = thresholdPercent != null ? Number(thresholdPercent) : null;

    if (departmentIds.length === 0) {
      return { month: m, priorMonth, thresholdPercent, rows: [] };
    }

    const fyStart = fiscalYearStart(m);
    const fyMonths = monthsBetweenInclusive(fyStart, m);
    const [current, prior, ytdSum] = await Promise.all([
      this.headTotalsForMonth(departmentIds, m),
      this.headTotalsForMonth(departmentIds, priorMonth),
      this.headTotalsForRange(departmentIds, fyStart, m),
    ]);

    const headIds = new Set<string>([...current.keys(), ...prior.keys()]);
    const rows: VarianceRow[] = [];
    for (const id of headIds) {
      const cur = current.get(id);
      const pri = prior.get(id);
      const name = cur?.name ?? pri?.name ?? id;
      const curNum = cur ? Number(cur.total) : 0;
      const priNum = pri ? Number(pri.total) : null;
      const ytdAverageNum = Number(ytdSum.get(id) ?? 0) / fyMonths;

      let deviationPercent: string | null = null;
      let flagged = false;
      if (priNum !== null && priNum !== 0) {
        const dev = ((curNum - priNum) / priNum) * 100;
        deviationPercent = dev.toFixed(2);
        flagged = thresholdNum !== null && Math.abs(dev) > thresholdNum;
      } else {
        flagged = thresholdNum !== null && curNum > 0;
      }

      rows.push({
        expenseHeadId: id,
        expenseHeadName: name,
        current: curNum.toFixed(2),
        prior: pri ? String(pri.total) : null,
        ytdAverage: ytdAverageNum.toFixed(2),
        deviationPercent,
        flagged,
      });
    }

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
    departmentIds: string[],
    month: string,
  ): Promise<Map<string, { name: string; total: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ expenseHeadId: string; expenseHeadName: string; total: string }>
    >(Prisma.sql`
      SELECT s.expenseHeadId AS expenseHeadId, MAX(s.expenseHeadNameAtSnapshot) AS expenseHeadName,
             CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      WHERE m.departmentId IN (${Prisma.join(departmentIds)}) AND m.month = ${month}
      GROUP BY s.expenseHeadId
    `);
    return new Map(
      rows.map((r) => [r.expenseHeadId, { name: r.expenseHeadName, total: String(r.total) }]),
    );
  }

  private async headTotalsForRange(
    departmentIds: string[],
    from: string,
    to: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ expenseHeadId: string; total: string }>>(Prisma.sql`
      SELECT s.expenseHeadId AS expenseHeadId, CAST(SUM(p.amount) AS CHAR) AS total
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      WHERE m.departmentId IN (${Prisma.join(departmentIds)}) AND m.month >= ${from} AND m.month <= ${to}
      GROUP BY s.expenseHeadId
    `);
    return new Map(rows.map((r) => [r.expenseHeadId, String(r.total)]));
  }

  // ── Filter dropdown options (scoped) ────────────────────────────────────────
  async filterOptions(user: RequestUser): Promise<CorpDashboardFilterOptions> {
    const departmentIds = await this.scope.accessibleDepartmentIds(user);
    if (departmentIds.length === 0) {
      return { departments: [], expenseHeads: [], budgetCodes: [] };
    }
    const [departments, expenseHeads, budgetCodes] = await Promise.all([
      this.prisma.corpDepartment.findMany({
        where: { id: { in: departmentIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.corpExpenseHead.findMany({
        where: { departmentId: { in: departmentIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.corpBudgetCode.findMany({
        where: { departmentId: { in: departmentIds } },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return {
      departments,
      expenseHeads: expenseHeads.map((h) => ({ id: h.id, name: h.name })),
      budgetCodes: budgetCodes.map((b) => ({ id: b.id, code: b.code })),
    };
  }
}

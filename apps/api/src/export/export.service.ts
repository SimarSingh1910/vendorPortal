import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';

/** One granular provisioned line (a single head's amount for a clinic/month). */
export interface ExportRow {
  clinicId: string;
  clinicName: string;
  month: string;
  status: SubmissionStatus;
  expenseHeadId: string;
  expenseHeadName: string;
  category: string;
  amount: string; // DECIMAL(14,2) as string
}

export interface ClinicMonthExport {
  clinicId: string;
  clinicName: string;
  month: string;
  status: SubmissionStatus;
  rows: Array<{ category: string; expenseHeadName: string; amount: string }>;
  total: string;
}

export interface MonthEndExport {
  month: string;
  clinics: Array<{ id: string; name: string; status: SubmissionStatus }>;
  heads: Array<{ id: string; name: string; category: string }>;
  /** amount[headId][clinicId] — present only where a value was entered. */
  amounts: Record<string, Record<string, string>>;
}

interface ExportFilters {
  clinicId?: string;
  expenseHeadId?: string;
  from?: string;
  to?: string;
  month?: string;
  // Matches the DTO/web field name (an array despite the singular).
  status?: SubmissionStatus[];
}

function sum(values: string[]): string {
  return values.reduce((acc, v) => acc + Number(v), 0).toFixed(2);
}

/**
 * Granular data feed for the Excel/PDF exporters (FR-10). Every query is
 * clinic-scoped (finance roles see all clinics, clinic roles only theirs) and
 * reads the FROZEN snapshot head name/category, so an export reflects each
 * month as it was provisioned. Aggregation stays in SQL (no per-row fetch).
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
  ) {}

  /** Granular provisioned rows for the given filters, scoped to the caller. */
  async detailRows(user: RequestUser, filters: ExportFilters): Promise<ExportRow[]> {
    const accessible = await this.scope.accessibleClinicIds(user);
    const clinicIds =
      filters.clinicId && accessible.includes(filters.clinicId)
        ? [filters.clinicId]
        : filters.clinicId
          ? []
          : accessible;
    if (clinicIds.length === 0) return [];

    const conds: Prisma.Sql[] = [Prisma.sql`m.clinicId IN (${Prisma.join(clinicIds)})`];
    if (filters.month) conds.push(Prisma.sql`m.month = ${filters.month}`);
    if (filters.from) conds.push(Prisma.sql`m.month >= ${filters.from}`);
    if (filters.to) conds.push(Prisma.sql`m.month <= ${filters.to}`);
    if (filters.expenseHeadId) conds.push(Prisma.sql`s.expenseHeadId = ${filters.expenseHeadId}`);
    if (filters.status?.length) conds.push(Prisma.sql`m.status IN (${Prisma.join(filters.status)})`);

    const rows = await this.prisma.$queryRaw<ExportRow[]>(Prisma.sql`
      SELECT c.id AS clinicId, c.name AS clinicName, m.month AS month, m.status AS status,
             s.expenseHeadId AS expenseHeadId,
             s.expenseHeadNameAtSnapshot AS expenseHeadName,
             s.expenseHeadCategoryAtSnapshot AS category,
             CAST(p.amount AS CHAR) AS amount
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN clinic c ON c.id = m.clinicId
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY c.name ASC, m.month ASC, s.expenseHeadCategoryAtSnapshot ASC, s.expenseHeadNameAtSnapshot ASC
    `);
    return rows.map((r) => ({ ...r, amount: String(r.amount) }));
  }

  /** One clinic's data for one month (FR-10: single-clinic Excel export). */
  async clinicMonth(user: RequestUser, clinicId: string, month: string): Promise<ClinicMonthExport> {
    if (!this.scope.canAccessClinic(user, clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { clinicId_month: { clinicId, month } },
      select: { status: true },
    });
    const detail = await this.detailRows(user, { clinicId, month });

    return {
      clinicId,
      clinicName: clinic?.name ?? clinicId,
      month,
      status: (submission?.status ?? SubmissionStatus.NOT_STARTED) as SubmissionStatus,
      rows: detail.map((r) => ({
        category: r.category,
        expenseHeadName: r.expenseHeadName,
        amount: r.amount,
      })),
      total: sum(detail.map((r) => r.amount)),
    };
  }

  /**
   * Month-end provision report (FR-10 one-click): every ACTIVE in-scope clinic,
   * every head provisioned that month, as a head×clinic matrix.
   */
  async monthEnd(user: RequestUser, month: string): Promise<MonthEndExport> {
    const accessible = await this.scope.accessibleClinicIds(user);
    if (accessible.length === 0) {
      return { month, clinics: [], heads: [], amounts: {} };
    }

    const activeClinics = await this.prisma.clinic.findMany({
      where: { isActive: true, id: { in: accessible } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const activeIds = new Set(activeClinics.map((c) => c.id));

    const submissions = await this.prisma.monthlySubmission.findMany({
      where: { month, clinicId: { in: [...activeIds] } },
      select: { clinicId: true, status: true },
    });
    const statusByClinic = new Map(submissions.map((s) => [s.clinicId, s.status as SubmissionStatus]));

    const detail = (await this.detailRows(user, { month })).filter((r) => activeIds.has(r.clinicId));

    const headMap = new Map<string, { id: string; name: string; category: string }>();
    const amounts: Record<string, Record<string, string>> = {};
    for (const r of detail) {
      if (!headMap.has(r.expenseHeadId)) {
        headMap.set(r.expenseHeadId, { id: r.expenseHeadId, name: r.expenseHeadName, category: r.category });
      }
      (amounts[r.expenseHeadId] ??= {})[r.clinicId] = r.amount;
    }
    const heads = [...headMap.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );

    return {
      month,
      clinics: activeClinics.map((c) => ({
        id: c.id,
        name: c.name,
        status: statusByClinic.get(c.id) ?? SubmissionStatus.NOT_STARTED,
      })),
      heads,
      amounts,
    };
  }
}

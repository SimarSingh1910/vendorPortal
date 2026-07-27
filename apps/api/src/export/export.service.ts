import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * One granular provisioned LINE — the single row shape behind ALL THREE clinic
 * Excel exports (individual / consolidated / month-end), which share one unified
 * 10-column finance layout. Per-line fields (G/L, amount, vendor, product,
 * description) vary per row; per-clinic (name + codes) and per-month values
 * repeat on every line so a multi-clinic/multi-month sheet is unambiguous.
 */
export interface ExportRow {
  clinicId: string;
  clinicName: string;
  // Clinic's fixed finance identifiers — repeated on every line of that clinic (read live).
  accLocationCode: string;
  customerCode: string;
  month: string;
  status: SubmissionStatus;
  expenseHeadId: string;
  glAccountName: string;
  glAccountNo: string;
  vendorName: string | null;
  productCode: string | null;
  // Description = the per-line SPOC note (optional); blank on the sheet when null.
  note: string | null;
  amount: string; // DECIMAL(14,2) as string
}

/** One clinic's month of lines, plus the clinic name (for the download filename). */
export interface ClinicMonthExport {
  clinicName: string;
  rows: ExportRow[];
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

/**
 * Granular data feed for the Excel/PDF exporters (FR-10). Every query is
 * clinic-scoped (finance roles see all clinics, clinic roles only theirs) and
 * reads the FROZEN snapshot G/L account no/name, so an export reflects each
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
    // A blank multi-vendor line (null amount) is an incomplete draft row with no
    // finance value — never export it as a "0" row (NULL ≠ 0).
    conds.push(Prisma.sql`p.amount IS NOT NULL`);

    const rows = await this.prisma.$queryRaw<ExportRow[]>(Prisma.sql`
      SELECT c.id AS clinicId, c.name AS clinicName,
             c.accLocationCode AS accLocationCode, c.customerCode AS customerCode,
             m.month AS month, m.status AS status,
             s.expenseHeadId AS expenseHeadId,
             s.expenseHeadGlNameAtSnapshot AS glAccountName,
             s.expenseHeadGlNoAtSnapshot AS glAccountNo,
             p.vendorName AS vendorName,
             p.productCode AS productCode,
             p.note AS note,
             CAST(p.amount AS CHAR) AS amount
      FROM provisionentry p
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN clinic c ON c.id = m.clinicId
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY c.name ASC, m.month ASC, s.expenseHeadGlNoAtSnapshot ASC, s.expenseHeadGlNameAtSnapshot ASC, p.lineOrder ASC
    `);
    return rows.map((r) => ({ ...r, amount: String(r.amount) }));
  }

  /** One clinic's month of lines (FR-10: single-clinic Excel export). */
  async clinicMonth(user: RequestUser, clinicId: string, month: string): Promise<ClinicMonthExport> {
    if (!this.scope.canAccessClinic(user, clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    const rows = await this.detailRows(user, { clinicId, month });
    return { clinicName: clinic?.name ?? clinicId, rows };
  }

  /**
   * Month-end provision report (FR-10 one-click): every provisioned line across
   * every ACTIVE in-scope clinic for the month, as flat per-line rows (same
   * unified 10-column layout as the other exports — Month + Clinic Name on every
   * row keep a multi-clinic sheet unambiguous). Clinics with no entries add no rows.
   */
  async monthEnd(user: RequestUser, month: string): Promise<ExportRow[]> {
    const accessible = await this.scope.accessibleClinicIds(user);
    if (accessible.length === 0) return [];

    const activeClinics = await this.prisma.clinic.findMany({
      where: { isActive: true, id: { in: accessible } },
      select: { id: true },
    });
    const activeIds = new Set(activeClinics.map((c) => c.id));

    return (await this.detailRows(user, { month })).filter((r) => activeIds.has(r.clinicId));
  }
}

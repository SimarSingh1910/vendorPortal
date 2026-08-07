import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * One granular provisioned PARTICULAR — the single row shape behind ALL THREE
 * clinic Excel exports (individual / consolidated / month-end), which share one
 * unified finance layout.
 *
 * GRAIN: one row per particular (rate × quantity), NOT per vendor line. Since a
 * vendor line's amount is now just the sum of its particulars, exporting at the
 * line grain would hide the rate/quantity detail finance needs to check a figure.
 * `amount` is therefore the PARTICULAR's value, and the head/line/clinic/month
 * context (G/L, vendor, product, clinic codes) repeats down the particulars of a
 * line — so summing the Amount column still yields exactly the same grand total as
 * before, just over more rows. The two per-particular fields are the exceptions,
 * varying row by row: `particularName` (the sheet's Description) and `remark` (the
 * sheet's trailing Remarks).
 */
export interface ExportRow {
  clinicId: string;
  clinicName: string;
  // Clinic's fixed finance identifiers — repeated on every line of that clinic (read live).
  accLocationCode: string;
  customerCode: string;
  customerName: string;
  month: string;
  status: SubmissionStatus;
  expenseHeadId: string;
  glAccountName: string;
  glAccountNo: string;
  vendorName: string | null;
  productCode: string | null;
  // THIS PARTICULAR's optional SPOC remark — the sheet's trailing `Remarks` column;
  // blank when null. Free-text commentary, kept clear of the figures rather than
  // sitting in Description (which names the particular).
  remark: string | null;
  // This PARTICULAR's derived value (rate × quantity), DECIMAL(14,2) as string.
  amount: string;
  // The particular's own name — the sheet's `Description`, immediately followed by
  // the Rate and Quantity that derive the Amount beside it.
  particularName: string | null;
  rate: string; // DECIMAL(14,4) as string
  quantity: string; // DECIMAL(14,3) as string
}

/** One clinic's month of particular rows, plus the clinic name (for the filename). */
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
    // A clinic filter may only ever NARROW the caller's own scope. Asking for a
    // clinic outside it is a scope violation, not an empty result set — answering
    // 200 + [] would let a SPOC probe which clinic ids exist by watching which
    // ones come back empty vs. populated. Deny it outright (`clinicMonth` below
    // does the same), so SPOC/cluster-manager exports cannot be widened by a
    // hand-crafted query string.
    if (filters.clinicId && !accessible.includes(filters.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    const clinicIds = filters.clinicId ? [filters.clinicId] : accessible;
    if (clinicIds.length === 0) return [];

    const conds: Prisma.Sql[] = [Prisma.sql`m.clinicId IN (${Prisma.join(clinicIds)})`];
    if (filters.month) conds.push(Prisma.sql`m.month = ${filters.month}`);
    if (filters.from) conds.push(Prisma.sql`m.month >= ${filters.from}`);
    if (filters.to) conds.push(Prisma.sql`m.month <= ${filters.to}`);
    if (filters.expenseHeadId) conds.push(Prisma.sql`s.expenseHeadId = ${filters.expenseHeadId}`);
    if (filters.status?.length) conds.push(Prisma.sql`m.status IN (${Prisma.join(filters.status)})`);
    // A blank line/particular is an incomplete draft with no finance value — never
    // export it as a "0" row (NULL ≠ 0). `p.amount IS NOT NULL` already implies
    // every particular of the line is complete (the line amount is NULL if any of
    // them is), but filter the particular too so the join can never widen a row set
    // with a half-filled row.
    conds.push(Prisma.sql`p.amount IS NOT NULL`);
    conds.push(Prisma.sql`ep.value IS NOT NULL`);

    const rows = await this.prisma.$queryRaw<ExportRow[]>(Prisma.sql`
      SELECT c.id AS clinicId, c.name AS clinicName,
             c.accLocationCode AS accLocationCode, c.customerCode AS customerCode,
             c.customerName AS customerName,
             m.month AS month, m.status AS status,
             s.expenseHeadId AS expenseHeadId,
             s.expenseHeadGlNameAtSnapshot AS glAccountName,
             s.expenseHeadGlNoAtSnapshot AS glAccountNo,
             p.vendorName AS vendorName,
             p.productCode AS productCode,
             ep.remark AS remark,
             CAST(ep.value AS CHAR) AS amount,
             ep.particularName AS particularName,
             CAST(ep.rate AS CHAR) AS rate,
             CAST(ep.quantity AS CHAR) AS quantity
      FROM provisionentry p
      JOIN entryparticular ep ON ep.entryId = p.id
      JOIN submissionexpenseheadsnapshot s ON s.id = p.snapshotId
      JOIN monthlysubmission m ON m.id = p.submissionId
      JOIN clinic c ON c.id = m.clinicId
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY c.name ASC, m.month ASC, s.expenseHeadGlNoAtSnapshot ASC, s.expenseHeadGlNameAtSnapshot ASC, p.lineOrder ASC, ep.lineOrder ASC
    `);
    return rows.map((r) => ({
      ...r,
      amount: String(r.amount),
      rate: String(r.rate),
      quantity: String(r.quantity),
    }));
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

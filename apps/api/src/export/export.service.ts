import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * One granular provisioned PARTICULAR — the row shape behind the clinic-month and
 * month-end Excel exports, which share the particular-level finance layout. (The
 * consolidated export is vendor level: see VendorExportRow.)
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
  // The clinic's ACTIVE SPOCs / cluster managers, comma-joined (null when none).
  spocNames: string | null;
  managerNames: string | null;
}

/**
 * One VENDOR LINE (a ProvisionEntry) — the grain of the consolidated Excel. The
 * amount is the line's stored total (the sum of its particulars), so there is no
 * particular name / rate / quantity / remark at this level. Two lines naming the
 * same vendor under one G/L stay two rows, exactly as the SPOC entered them.
 */
export type VendorExportRow = Omit<ExportRow, 'remark' | 'particularName' | 'rate' | 'quantity'>;

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

/** Comma-joined names of the clinic's ACTIVE users in `role` (correlated on `c`). */
function clinicPeople(role: 'CLINIC_SPOC' | 'CLINIC_MANAGER'): Prisma.Sql {
  return Prisma.sql`(SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ')
      FROM UserClinicAssignment a JOIN \`User\` u ON u.id = a.userId
      WHERE a.clinicId = c.id AND u.role = ${role} AND u.isActive = 1)`;
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

  /**
   * The WHERE conditions shared by every clinic export query: the caller's clinic
   * scope narrowed by the filters. `null` when the caller can see no clinic.
   */
  private async scopedConds(user: RequestUser, filters: ExportFilters): Promise<Prisma.Sql[] | null> {
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
    if (clinicIds.length === 0) return null;

    const conds: Prisma.Sql[] = [Prisma.sql`m.clinicId IN (${Prisma.join(clinicIds)})`];
    if (filters.month) conds.push(Prisma.sql`m.month = ${filters.month}`);
    if (filters.from) conds.push(Prisma.sql`m.month >= ${filters.from}`);
    if (filters.to) conds.push(Prisma.sql`m.month <= ${filters.to}`);
    if (filters.expenseHeadId) conds.push(Prisma.sql`s.expenseHeadId = ${filters.expenseHeadId}`);
    if (filters.status?.length) conds.push(Prisma.sql`m.status IN (${Prisma.join(filters.status)})`);
    return conds;
  }

  /** Granular provisioned rows (one per PARTICULAR) for the given filters, scoped to the caller. */
  async detailRows(user: RequestUser, filters: ExportFilters): Promise<ExportRow[]> {
    const conds = await this.scopedConds(user, filters);
    if (!conds) return [];
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
             CAST(ep.quantity AS CHAR) AS quantity,
             ${clinicPeople('CLINIC_SPOC')} AS spocNames,
             ${clinicPeople('CLINIC_MANAGER')} AS managerNames
      FROM ProvisionEntry p
      JOIN EntryParticular ep ON ep.entryId = p.id
      JOIN SubmissionExpenseHeadSnapshot s ON s.id = p.snapshotId
      JOIN MonthlySubmission m ON m.id = p.submissionId
      JOIN Clinic c ON c.id = m.clinicId
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

  /**
   * One row per VENDOR LINE for the given filters, scoped to the caller — the
   * consolidated Excel's grain. Same scope and filters as `detailRows`; only lines
   * with a complete (non-NULL) total are exported, so the Amount column sums to the
   * same grand total as the particular-level exports.
   */
  async vendorLineRows(user: RequestUser, filters: ExportFilters): Promise<VendorExportRow[]> {
    const conds = await this.scopedConds(user, filters);
    if (!conds) return [];
    conds.push(Prisma.sql`p.amount IS NOT NULL`);

    const rows = await this.prisma.$queryRaw<VendorExportRow[]>(Prisma.sql`
      SELECT c.id AS clinicId, c.name AS clinicName,
             c.accLocationCode AS accLocationCode, c.customerCode AS customerCode,
             c.customerName AS customerName,
             m.month AS month, m.status AS status,
             s.expenseHeadId AS expenseHeadId,
             s.expenseHeadGlNameAtSnapshot AS glAccountName,
             s.expenseHeadGlNoAtSnapshot AS glAccountNo,
             p.vendorName AS vendorName,
             p.productCode AS productCode,
             CAST(p.amount AS CHAR) AS amount,
             ${clinicPeople('CLINIC_SPOC')} AS spocNames,
             ${clinicPeople('CLINIC_MANAGER')} AS managerNames
      FROM ProvisionEntry p
      JOIN SubmissionExpenseHeadSnapshot s ON s.id = p.snapshotId
      JOIN MonthlySubmission m ON m.id = p.submissionId
      JOIN Clinic c ON c.id = m.clinicId
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY c.name ASC, c.id ASC, m.month ASC, s.expenseHeadGlNoAtSnapshot ASC, s.expenseHeadGlNameAtSnapshot ASC, p.lineOrder ASC, p.id ASC
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
   * every ACTIVE in-scope clinic for the month, as flat per-particular rows (the
   * same particular-level layout as the clinic-month export — Month + Clinic Name on
   * every row keep a multi-clinic sheet unambiguous). Clinics with no entries add no rows.
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

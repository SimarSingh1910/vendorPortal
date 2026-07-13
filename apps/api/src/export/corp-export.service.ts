import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CorpSubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * One granular corporate provision LINE — the single row shape behind BOTH
 * corporate Excel exports (individual submission / combined month-end), which
 * share one unified column layout. Per-line fields (head, budget code, amount,
 * vendor, location, note) vary per row; Department + Month repeat on every line so
 * a multi-department month-end sheet stays unambiguous. Reads the FROZEN snapshot
 * head name so an export reflects the month as it was provisioned.
 */
export interface CorpExportRow {
  departmentId: string;
  departmentName: string;
  month: string;
  status: CorpSubmissionStatus;
  expenseHead: string;
  budgetCode: string;
  vendorName: string | null;
  location: string | null;
  // Description = the per-line SPOC note (optional); blank on the sheet when null.
  note: string | null;
  amount: string; // DECIMAL(14,2) as string
  hclAvitasShare: string | null; // DECIMAL(14,2) as string; only the Sec 24 pool, frozen on approval
}

/** One submission's lines plus its department + month (for the download filename). */
export interface CorpSubmissionExport {
  departmentName: string;
  month: string;
  rows: CorpExportRow[];
}

/**
 * Granular data feed for the corporate Excel exporters. Every query is
 * department-scoped (approvers see every department, dept roles only theirs) via
 * CorpDepartmentScopeService, mirroring the clinic ExportService. Aggregation
 * stays in SQL (no per-row fetch).
 */
@Injectable()
export class CorpExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
  ) {}

  /** Granular corporate lines for the given department set + optional month. */
  private async detailRows(departmentIds: string[], month?: string): Promise<CorpExportRow[]> {
    if (departmentIds.length === 0) return [];

    const conds: Prisma.Sql[] = [Prisma.sql`m.departmentId IN (${Prisma.join(departmentIds)})`];
    if (month) conds.push(Prisma.sql`m.month = ${month}`);

    const rows = await this.prisma.$queryRaw<CorpExportRow[]>(Prisma.sql`
      SELECT d.id AS departmentId, d.name AS departmentName,
             m.month AS month, m.status AS status,
             s.expenseHeadNameAtSnapshot AS expenseHead,
             b.code AS budgetCode,
             p.vendorName AS vendorName,
             p.location AS location,
             p.note AS note,
             CAST(p.amount AS CHAR) AS amount,
             CAST(p.hclAvitasShare AS CHAR) AS hclAvitasShare
      FROM corp_provision_entries p
      JOIN corp_submission_expense_head_snapshots s ON s.id = p.snapshotId
      JOIN corp_monthly_submissions m ON m.id = p.submissionId
      JOIN corp_departments d ON d.id = m.departmentId
      JOIN corp_budget_codes b ON b.id = p.budgetCodeId
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY d.name ASC, m.month ASC, s.expenseHeadNameAtSnapshot ASC
    `);
    return rows.map((r) => ({
      ...r,
      amount: String(r.amount),
      hclAvitasShare: r.hclAvitasShare === null ? null : String(r.hclAvitasShare),
    }));
  }

  /** One submission's lines (individual corporate Excel export). */
  async submissionExport(user: RequestUser, submissionId: string): Promise<CorpSubmissionExport> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { departmentId: true, month: true, department: { select: { name: true } } },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!(await this.scope.canAccessDepartment(user, submission.departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }
    const rows = (await this.detailRows([submission.departmentId], submission.month)).filter(
      (r) => r.departmentId === submission.departmentId,
    );
    return { departmentName: submission.department.name, month: submission.month, rows };
  }

  /**
   * Combined month-end report: every provisioned line across every ACTIVE in-scope
   * department for the month, as flat per-line rows (Department + Month on every
   * row keep the multi-department sheet unambiguous). Departments with no entries
   * add no rows.
   */
  async monthEnd(user: RequestUser, month: string): Promise<CorpExportRow[]> {
    const accessible = await this.scope.accessibleDepartmentIds(user);
    if (accessible.length === 0) return [];

    const activeDepartments = await this.prisma.corpDepartment.findMany({
      where: { isActive: true, id: { in: accessible } },
      select: { id: true },
    });
    return this.detailRows(
      activeDepartments.map((d) => d.id),
      month,
    );
  }
}

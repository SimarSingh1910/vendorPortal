import { Injectable } from '@nestjs/common';
import { type UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CORP_FULL_DEPARTMENT_ACCESS_ROLES } from '../common/rbac.constants';
import type { RequestUser } from '../auth/request-user';

/**
 * Resolves which corporate departments a user may act on — the corporate analogue
 * of ClinicScopeService.
 *
 * FINANCE_ADMIN and CORP_FINANCE_MANAGER have org-wide access to every department
 * (no assignment rows). Department-scoped roles (DEPT_SPOC / DEPT_VIEWER) are
 * limited to the departments they're assigned to. Unlike the clinic scope (which
 * reads clinicIds off the access token), corporate assignments are NOT carried in
 * the JWT, so membership is resolved from user_department_assignments — a fresh
 * read each call, so assignment changes take effect immediately.
 */
@Injectable()
export class CorpDepartmentScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** True for roles with org-wide (all-department) access. */
  hasFullDepartmentAccess(user: RequestUser): boolean {
    return (CORP_FULL_DEPARTMENT_ACCESS_ROLES as readonly UserRole[]).includes(user.role);
  }

  /** The set of department IDs this user may act on (all for approvers; assigned otherwise). */
  async accessibleDepartmentIds(user: RequestUser): Promise<string[]> {
    if (this.hasFullDepartmentAccess(user)) {
      const departments = await this.prisma.corpDepartment.findMany({ select: { id: true } });
      return departments.map((d) => d.id);
    }
    const rows = await this.prisma.userDepartmentAssignment.findMany({
      where: { userId: user.id },
      select: { departmentId: true },
    });
    return rows.map((r) => r.departmentId);
  }

  /** Membership check; short-circuits for approver roles to avoid a lookup. */
  async canAccessDepartment(user: RequestUser, departmentId: string): Promise<boolean> {
    if (this.hasFullDepartmentAccess(user)) return true;
    const row = await this.prisma.userDepartmentAssignment.findUnique({
      where: { userId_departmentId: { userId: user.id, departmentId } },
      select: { id: true },
    });
    return row !== null;
  }

  /** Resolve the department a corporate submission belongs to, or null if absent. */
  async resolveSubmissionDepartmentId(submissionId: string): Promise<string | null> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { departmentId: true },
    });
    return submission?.departmentId ?? null;
  }
}

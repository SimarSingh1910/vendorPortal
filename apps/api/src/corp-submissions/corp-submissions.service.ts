import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CorpDepartmentType,
  CorpSubmissionStatus,
  UserRole,
  type CorpDepartmentMonthStatus,
  type CorpSubmissionDetail,
  type CorpSubmissionListItem,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { Sec24AllocationService } from './sec24-allocation.service';
import type { RequestUser } from '../auth/request-user';
import { isCorpLocked, isCorpReviewEditable, isCorpSpocEditable } from './corp-workflow.service';

/**
 * Read side of the corporate submission/provision surface (Phase C2): the dept
 * SPOC overview, a department's submission history, the approver's cross-dept
 * review queue, and the full provision-form detail. All access is
 * department-scoped (approvers see every department).
 */
@Injectable()
export class CorpSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
    private readonly sec24: Sec24AllocationService,
  ) {}

  /**
   * One row per ACTIVE department the user can access, with that department's
   * submission status for `month` (NOT_STARTED + null id when not open yet).
   */
  async getOverview(user: RequestUser, month: string): Promise<CorpDepartmentMonthStatus[]> {
    const departmentIds = await this.scope.accessibleDepartmentIds(user);
    if (departmentIds.length === 0) return [];

    const departments = await this.prisma.corpDepartment.findMany({
      where: { id: { in: departmentIds }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const submissions = await this.prisma.corpMonthlySubmission.findMany({
      where: { month, departmentId: { in: departments.map((d) => d.id) } },
      select: { id: true, departmentId: true, status: true },
    });
    const byDept = new Map(submissions.map((s) => [s.departmentId, s]));

    return departments.map((department) => {
      const sub = byDept.get(department.id);
      const status =
        (sub?.status as CorpSubmissionStatus | undefined) ?? CorpSubmissionStatus.NOT_STARTED;
      return {
        departmentId: department.id,
        departmentName: department.name,
        month,
        submissionId: sub?.id ?? null,
        status,
        locked: isCorpLocked(status),
      };
    });
  }

  /** A department's submissions, newest month first, optionally filtered. */
  async listForDepartment(
    departmentId: string,
    user: RequestUser,
    filter: { statuses?: CorpSubmissionStatus[]; month?: string } = {},
  ): Promise<CorpSubmissionListItem[]> {
    if (!(await this.scope.canAccessDepartment(user, departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }
    const submissions = await this.prisma.corpMonthlySubmission.findMany({
      where: {
        departmentId,
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(filter.month ? { month: filter.month } : {}),
      },
      include: { department: { select: { name: true } } },
      orderBy: { month: 'desc' },
    });
    return submissions.map((s) => this.toListItem(s));
  }

  /**
   * The approver's cross-department work queue: every submission in `statuses`
   * across all departments they can access, oldest first (FIFO review order).
   */
  async listQueue(
    user: RequestUser,
    query: { statuses: CorpSubmissionStatus[]; month?: string },
  ): Promise<CorpSubmissionListItem[]> {
    const departmentIds = await this.scope.accessibleDepartmentIds(user);
    if (departmentIds.length === 0) return [];

    const submissions = await this.prisma.corpMonthlySubmission.findMany({
      where: {
        departmentId: { in: departmentIds },
        status: { in: query.statuses },
        ...(query.month ? { month: query.month } : {}),
      },
      include: { department: { select: { name: true } } },
      orderBy: [{ submittedAt: 'asc' }, { month: 'asc' }],
    });
    return submissions.map((s) => this.toListItem(s));
  }

  private toListItem(s: {
    id: string;
    departmentId: string;
    department: { name: string };
    month: string;
    status: string;
    submittedAt: Date | null;
    financeApprovedAt: Date | null;
  }): CorpSubmissionListItem {
    return {
      id: s.id,
      departmentId: s.departmentId,
      departmentName: s.department.name,
      month: s.month,
      status: s.status as CorpSubmissionStatus,
      locked: isCorpLocked(s.status as CorpSubmissionStatus),
      submittedAt: s.submittedAt?.toISOString() ?? null,
      financeApprovedAt: s.financeApprovedAt?.toISOString() ?? null,
    };
  }

  /**
   * The provision form / read-only detail: snapshot heads + any entered line
   * (budget code, amount, Sec 24 share), plus the department's ACTIVE budget
   * codes for the per-line dropdown (BR-C02).
   */
  async getDetail(submissionId: string, user: RequestUser): Promise<CorpSubmissionDetail> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      include: {
        department: { select: { name: true, type: true } },
        snapshots: {
          include: { entry: true },
          orderBy: { expenseHeadNameAtSnapshot: 'asc' },
        },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!(await this.scope.canAccessDepartment(user, submission.departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }

    const budgetCodes = await this.prisma.corpBudgetCode.findMany({
      where: { departmentId: submission.departmentId, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, description: true },
    });

    const status = submission.status as CorpSubmissionStatus;
    const isSpoc = user.role === UserRole.DEPT_SPOC;
    const isApprover = (CORP_FINANCE_APPROVER_ROLES as readonly UserRole[]).includes(user.role);

    // Sec 24 share: the % applied is the FROZEN snapshot once approved, else the
    // currently-active % for the month (real-time, BR-C04); null until ever set
    // (BR-C03 → "—"). Share is computed from that % so already-entered amounts
    // start showing a share the moment a % is set, without a re-save.
    const isPool = submission.department.type === CorpDepartmentType.SHARED_COST_POOL;
    let resolvedPct: Prisma.Decimal | null = null;
    if (isPool) {
      resolvedPct =
        status === CorpSubmissionStatus.FINANCE_APPROVED && submission.sec24PctSnapshot !== null
          ? submission.sec24PctSnapshot
          : await this.sec24.activePctForMonth(submission.month);
    }

    return {
      id: submission.id,
      departmentId: submission.departmentId,
      departmentName: submission.department.name,
      month: submission.month,
      status,
      locked: isCorpLocked(status),
      canEdit: isSpoc && isCorpSpocEditable(status),
      canReview: isApprover && isCorpReviewEditable(status),
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      financeApprovedAt: submission.financeApprovedAt?.toISOString() ?? null,
      isSharedCostPool: isPool,
      sec24AllocationPct: resolvedPct ? resolvedPct.toFixed(2) : null,
      budgetCodes: budgetCodes.map((b) => ({ id: b.id, code: b.code, description: b.description })),
      heads: submission.snapshots.map((snap) => ({
        snapshotId: snap.id,
        expenseHeadId: snap.expenseHeadId,
        name: snap.expenseHeadNameAtSnapshot,
        budgetCodeId: snap.entry?.budgetCodeId ?? null,
        amount: snap.entry ? snap.entry.amount.toFixed(2) : null,
        hclAvitasShare:
          isPool && resolvedPct !== null && snap.entry
            ? this.sec24.computeShare(snap.entry.amount, resolvedPct)!.toFixed(2)
            : null,
      })),
    };
  }
}

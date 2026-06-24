import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  SubmissionStatus,
  UserRole,
  type ClinicMonthStatus,
  type SubmissionDetail,
  type SubmissionListItem,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';
import { canSpocRecall, isSpocEditable } from './workflow.service';

const isLocked = (status: SubmissionStatus): boolean => status === SubmissionStatus.FINANCE_APPROVED;

/**
 * Read side of the submission/provision surface (Phase 6): the SPOC home
 * overview, a clinic's submission history, and the full provision-form detail.
 * All access is clinic-scoped (finance roles see every clinic).
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
  ) {}

  /**
   * One row per ACTIVE clinic the user can access, with that clinic's submission
   * status for `month` (NOT_STARTED + null id when the cycle isn't open yet).
   */
  async getOverview(user: RequestUser, month: string): Promise<ClinicMonthStatus[]> {
    const clinicIds = await this.scope.accessibleClinicIds(user);
    if (clinicIds.length === 0) return [];

    const clinics = await this.prisma.clinic.findMany({
      where: { id: { in: clinicIds }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const submissions = await this.prisma.monthlySubmission.findMany({
      where: { month, clinicId: { in: clinics.map((c) => c.id) } },
      select: { id: true, clinicId: true, status: true },
    });
    const byClinic = new Map(submissions.map((s) => [s.clinicId, s]));

    return clinics.map((clinic) => {
      const sub = byClinic.get(clinic.id);
      const status = (sub?.status as SubmissionStatus | undefined) ?? SubmissionStatus.NOT_STARTED;
      return {
        clinicId: clinic.id,
        clinicName: clinic.name,
        month,
        submissionId: sub?.id ?? null,
        status,
        locked: isLocked(status),
      };
    });
  }

  /** A clinic's submissions, newest month first, optionally filtered. */
  async listForClinic(
    clinicId: string,
    user: RequestUser,
    filter: { statuses?: SubmissionStatus[]; month?: string } = {},
  ): Promise<SubmissionListItem[]> {
    if (!this.scope.canAccessClinic(user, clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    const submissions = await this.prisma.monthlySubmission.findMany({
      where: {
        clinicId,
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(filter.month ? { month: filter.month } : {}),
      },
      include: { clinic: { select: { name: true } } },
      orderBy: { month: 'desc' },
    });
    return submissions.map((s) => this.toListItem(s));
  }

  /**
   * The caller's cross-clinic work queue: every submission in `statuses` across
   * all clinics they can access, oldest submission first (FIFO review order).
   * Powers the Manager/Finance review trackers.
   */
  async listQueue(
    user: RequestUser,
    query: { statuses: SubmissionStatus[]; month?: string },
  ): Promise<SubmissionListItem[]> {
    const clinicIds = await this.scope.accessibleClinicIds(user);
    if (clinicIds.length === 0) return [];

    const submissions = await this.prisma.monthlySubmission.findMany({
      where: {
        clinicId: { in: clinicIds },
        status: { in: query.statuses },
        ...(query.month ? { month: query.month } : {}),
      },
      include: { clinic: { select: { name: true } } },
      orderBy: [{ submittedAt: 'asc' }, { month: 'asc' }],
    });
    return submissions.map((s) => this.toListItem(s));
  }

  private toListItem(
    s: {
      id: string;
      clinicId: string;
      clinic: { name: string };
      month: string;
      status: string;
      submittedAt: Date | null;
      approvedByFinanceAt: Date | null;
    },
  ): SubmissionListItem {
    return {
      id: s.id,
      clinicId: s.clinicId,
      clinicName: s.clinic.name,
      month: s.month,
      status: s.status as SubmissionStatus,
      locked: isLocked(s.status as SubmissionStatus),
      submittedAt: s.submittedAt?.toISOString() ?? null,
      approvedByFinanceAt: s.approvedByFinanceAt?.toISOString() ?? null,
    };
  }

  /** The provision form / read-only detail: snapshot heads + any entered values. */
  async getDetail(submissionId: string, user: RequestUser): Promise<SubmissionDetail> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      include: {
        clinic: { select: { name: true } },
        reviewStartedBy: { select: { name: true } },
        snapshots: {
          include: { entry: true },
          orderBy: [{ expenseHeadCategoryAtSnapshot: 'asc' }, { expenseHeadNameAtSnapshot: 'asc' }],
        },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }

    const status = submission.status as SubmissionStatus;
    const isSpoc = user.role === UserRole.CLINIC_SPOC;
    const canEdit = isSpoc && isSpocEditable(status);
    const canRecall = isSpoc && canSpocRecall(status);

    return {
      id: submission.id,
      clinicId: submission.clinicId,
      clinicName: submission.clinic.name,
      month: submission.month,
      status,
      locked: isLocked(status),
      canEdit,
      canRecall,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
      reviewStartedByName: submission.reviewStartedBy?.name ?? null,
      unlockedReason: submission.unlockedReason ?? null,
      heads: submission.snapshots.map((snap) => ({
        snapshotId: snap.id,
        expenseHeadId: snap.expenseHeadId,
        name: snap.expenseHeadNameAtSnapshot,
        category: snap.expenseHeadCategoryAtSnapshot,
        amount: snap.entry ? snap.entry.amount.toFixed(2) : null,
        note: snap.entry?.note ?? null,
      })),
    };
  }
}

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  QUANTITY_DECIMALS,
  RATE_DECIMALS,
  SubmissionStatus,
  UserRole,
  type ClinicMonthStatus,
  type ProvisionParticular,
  type SubmissionDetail,
  type SubmissionListItem,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';
import { canSpocRecall, isSpocEditable } from './workflow.service';
import { CycleService } from './cycle.service';

const isLocked = (status: SubmissionStatus): boolean => status === SubmissionStatus.FINANCE_APPROVED;

/**
 * The empty particular a not-yet-started vendor line renders. Blank rather than
 * zeroed: an untouched head is INCOMPLETE (and blocks submit), not a ₹0 head.
 */
const BLANK_PARTICULAR: ProvisionParticular = {
  particularId: null,
  particularName: null,
  rate: null,
  quantity: null,
  value: null,
  remark: null,
  lineOrder: 0,
};

/**
 * Read side of the submission/provision surface (Phase 6): the SPOC home
 * overview, a clinic's submission history, and the full provision-form detail.
 * All access is clinic-scoped (finance roles see every clinic).
 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
    private readonly cycle: CycleService,
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
    let submission = await this.loadDetail(submissionId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    // A cycle with nothing entered yet follows the clinic's current mapping (see
    // CycleService.resyncUntouched). Best-effort: a failed resync must never stop
    // the form loading — the next load simply tries again.
    const status = submission.status as SubmissionStatus;
    const hasEntries = submission.snapshots.some((s) => s.entries.length > 0);
    if ((status === SubmissionStatus.NOT_STARTED || status === SubmissionStatus.DRAFT) && !hasEntries) {
      let changed = false;
      try {
        changed = await this.cycle.resyncUntouched(submissionId);
      } catch (err) {
        this.logger.warn(`head resync failed for ${submissionId}: ${(err as Error).message}`);
      }
      if (changed) submission = (await this.loadDetail(submissionId)) ?? submission;
    }
    return this.toDetail(submission, user, await this.loadActors(submissionId));
  }

  /**
   * Latest actor per workflow step, read from the audit trail (every transition is
   * audited, comment or not). Callers only show a name while its step's stamp is
   * set, so a recall — which clears the stamps — hides stale names. Where the
   * audit row has no actor (seeded/imported history), fall back to the author of
   * that step's timeline comment, if one was left.
   */
  private async loadActors(submissionId: string): Promise<Record<string, string | null>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'MonthlySubmission',
        entityId: submissionId,
        action: { in: ['SUBMISSION_SUBMIT', 'SUBMISSION_MANAGER_APPROVE', 'SUBMISSION_FINANCE_APPROVE'] },
      },
      orderBy: { performedAt: 'desc' },
      select: { action: true, performedBy: { select: { name: true } } },
    });
    const actors: Record<string, string | null> = {};
    for (const r of rows) {
      if (!(r.action in actors)) actors[r.action] = r.performedBy?.name ?? null;
    }
    if (Object.keys(actors).length === 3 && Object.values(actors).every(Boolean)) return actors;

    const comments = await this.prisma.submissionComment.findMany({
      where: { submissionId, action: { in: ['SUBMITTED', 'APPROVED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { action: true, roleAtTime: true, commentedBy: { select: { name: true } } },
    });
    for (const c of comments) {
      const step =
        c.action === 'SUBMITTED'
          ? 'SUBMISSION_SUBMIT'
          : c.roleAtTime === UserRole.CLINIC_MANAGER
            ? 'SUBMISSION_MANAGER_APPROVE'
            : 'SUBMISSION_FINANCE_APPROVE';
      actors[step] ??= c.commentedBy.name;
    }
    return actors;
  }

  private loadDetail(submissionId: string) {
    return this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      include: {
        clinic: {
          select: { name: true, accLocationCode: true, customerCode: true, customerName: true },
        },
        reviewStartedBy: { select: { name: true } },
        snapshots: {
          include: {
            entries: {
              orderBy: { lineOrder: 'asc' },
              include: { particulars: { orderBy: { lineOrder: 'asc' } } },
            },
          },
          orderBy: [{ expenseHeadGlNoAtSnapshot: 'asc' }, { expenseHeadGlNameAtSnapshot: 'asc' }],
        },
      },
    });
  }

  private toDetail(
    submission: NonNullable<Awaited<ReturnType<SubmissionsService['loadDetail']>>>,
    user: RequestUser,
    actors: Record<string, string | null>,
  ): SubmissionDetail {
    const status = submission.status as SubmissionStatus;
    const isSpoc = user.role === UserRole.CLINIC_SPOC;
    const canEdit = isSpoc && isSpocEditable(status);
    const canRecall = isSpoc && canSpocRecall(status);

    return {
      id: submission.id,
      clinicId: submission.clinicId,
      clinicName: submission.clinic.name,
      clinicAccLocationCode: submission.clinic.accLocationCode,
      clinicCustomerCode: submission.clinic.customerCode,
      clinicCustomerName: submission.clinic.customerName,
      month: submission.month,
      status,
      locked: isLocked(status),
      canEdit,
      canRecall,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
      reviewStartedByName: submission.reviewStartedBy?.name ?? null,
      submittedByName: submission.submittedAt ? (actors.SUBMISSION_SUBMIT ?? null) : null,
      approvedByManagerAt: submission.approvedByManagerAt?.toISOString() ?? null,
      approvedByManagerName: submission.approvedByManagerAt
        ? (actors.SUBMISSION_MANAGER_APPROVE ?? null)
        : null,
      approvedByFinanceAt: submission.approvedByFinanceAt?.toISOString() ?? null,
      approvedByFinanceName: submission.approvedByFinanceAt
        ? (actors.SUBMISSION_FINANCE_APPROVE ?? null)
        : null,
      unlockedReason: submission.unlockedReason ?? null,
      heads: submission.snapshots.map((snap) => ({
        snapshotId: snap.id,
        expenseHeadId: snap.expenseHeadId,
        glAccountNo: snap.expenseHeadGlNoAtSnapshot,
        glAccountName: snap.expenseHeadGlNameAtSnapshot,
        allowsMultipleVendors: snap.expenseHeadAllowsMultipleVendorsAtSnapshot,
        // Always at least one line, and every line always at least one particular:
        // a head with no entries shows a single blank line holding a single blank
        // particular, so the form/review renders the full nesting (null amount and
        // null rate/quantity, never "0.00").
        lines:
          snap.entries.length > 0
            ? snap.entries.map((e) => ({
                entryId: e.id,
                // DERIVED server-side from the particulars on save; read back here.
                amount: e.amount === null ? null : e.amount.toFixed(2),
                vendorName: e.vendorName ?? null,
                productCode: e.productCode ?? null,
                lineOrder: e.lineOrder,
                particulars:
                  e.particulars.length > 0
                    ? e.particulars.map((p) => ({
                        particularId: p.id,
                        particularName: p.particularName ?? null,
                        rate: p.rate === null ? null : p.rate.toFixed(RATE_DECIMALS),
                        quantity:
                          p.quantity === null ? null : p.quantity.toFixed(QUANTITY_DECIMALS),
                        value: p.value === null ? null : p.value.toFixed(2),
                        remark: p.remark ?? null,
                        lineOrder: p.lineOrder,
                      }))
                    : [BLANK_PARTICULAR],
              }))
            : [
                {
                  entryId: null,
                  amount: null,
                  vendorName: null,
                  productCode: null,
                  lineOrder: 0,
                  particulars: [BLANK_PARTICULAR],
                },
              ],
      })),
    };
  }
}

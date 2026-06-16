import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SubmissionStatus,
  UserRole,
  type ProvisionEntryInput,
  type SubmissionDetail,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/request-user';
import { WorkflowService, isSpocEditable } from './workflow.service';
import { SubmissionsService } from './submissions.service';

const isLocked = (status: SubmissionStatus): boolean => status === SubmissionStatus.FINANCE_APPROVED;

/**
 * Provision data entry (Phase 6) + lock enforcement & Finance-Admin override
 * (Phase 8, BR-08). Two write paths share this service:
 *
 *  - SPOC: partial upsert while the submission is SPOC-actionable; moves it to
 *    DRAFT via the state machine. Editing a locked submission → 403; editing in
 *    any other non-actionable state → 409.
 *  - FINANCE_ADMIN: may edit at ANY status (including FINANCE_APPROVED/locked)
 *    WITHOUT changing the status, and every such edit writes an audit entry.
 *
 * Manager/Viewer never reach this service (route is SPOC + FINANCE_ADMIN only),
 * but the lock check below is role-based so it holds even if called directly.
 */
@Injectable()
export class ProvisionEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly submissions: SubmissionsService,
  ) {}

  async saveEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
    ipAddress = '',
  ): Promise<SubmissionDetail> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, clinicId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }

    const status = submission.status as SubmissionStatus;
    const isAdmin = user.role === UserRole.FINANCE_ADMIN;

    // Lock enforcement: a FINANCE_APPROVED submission is editable only by a
    // Finance Admin (BR-08). Everyone else → 403.
    if (isLocked(status) && !isAdmin) {
      throw new ForbiddenException('This submission is locked');
    }
    // Non-admins may only edit in SPOC-actionable states.
    if (!isAdmin && !isSpocEditable(status)) {
      throw new ConflictException(`Cannot edit a submission in ${status}`);
    }

    if (items.length > 0) {
      await this.applyEntries(submissionId, user, items, isAdmin, ipAddress);
    }

    if (isAdmin) {
      // Override edits never change the workflow status (a locked item stays
      // locked); the change is captured by the audit entry written above.
    } else {
      // SPOC save: persisting progress moves NOT_STARTED / SENT_BACK_* → DRAFT.
      await this.workflow.saveDraft(submissionId, user);
    }

    return this.submissions.getDetail(submissionId, user);
  }

  /** Validate the targets, capture before/after for admin audit, then upsert. */
  private async applyEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
    isAdmin: boolean,
    ipAddress: string,
  ): Promise<void> {
    const snaps = await this.prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      select: { id: true },
    });
    const valid = new Set(snaps.map((s) => s.id));
    for (const item of items) {
      if (!valid.has(item.snapshotId)) {
        throw new BadRequestException('Unknown snapshot head for this submission');
      }
    }

    // For an admin override, snapshot the prior values so the audit captures the change.
    const before = isAdmin
      ? await this.prisma.provisionEntry.findMany({
          where: { snapshotId: { in: items.map((i) => i.snapshotId) } },
          select: { snapshotId: true, amount: true },
        })
      : [];

    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.provisionEntry.upsert({
          where: { snapshotId: item.snapshotId },
          update: { amount: item.amount, lastModifiedById: user.id },
          create: {
            submissionId,
            snapshotId: item.snapshotId,
            amount: item.amount,
            enteredById: user.id,
            lastModifiedById: user.id,
          },
        }),
      ),
    );

    if (isAdmin) {
      await this.audit.log({
        entityType: 'MonthlySubmission',
        entityId: submissionId,
        action: 'PROVISION_EDIT_OVERRIDE',
        performedById: user.id,
        ipAddress,
        oldValue: before.map((b) => ({ snapshotId: b.snapshotId, amount: b.amount.toFixed(2) })),
        newValue: items,
      });
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  SubmissionStatus,
  UserRole,
  type ProvisionEntryInput,
  type SubmissionDetail,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/request-user';
import { WorkflowService, isSpocEditable } from './workflow.service';
import { SubmissionsService } from './submissions.service';

const isLocked = (status: SubmissionStatus): boolean => status === SubmissionStatus.FINANCE_APPROVED;

/** Statuses in which the clinic manager owns the submission and may override values. */
const MANAGER_REVIEW_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CLINIC_MANAGER_REVIEW,
];

/** How an incoming edit is classified — drives the audit action and whether the
 * SPOC draft-save transition fires. */
type WriteKind = 'spoc' | 'manager-override' | 'finance-override';

/**
 * Provision data entry (Phase 6) + lock enforcement, manager override, and
 * finance override (Phase 8, BR-08). Three write paths share this service, all
 * writing the CANONICAL submission entries (single source of truth):
 *
 *  - SPOC: partial upsert while the submission is SPOC-actionable; moves it to
 *    DRAFT via the state machine. Editing a locked submission → 403; editing in
 *    any other non-actionable state → 409.
 *  - Clinic Manager (own clinic): may override values ONLY during their review
 *    stage (SUBMITTED / CLINIC_MANAGER_REVIEW), WITHOUT changing the status;
 *    every edit is audited (MANAGER_PROVISION_OVERRIDE). Editing outside that
 *    stage → 409, another clinic → 403, a locked submission → 403.
 *  - Finance approver (Admin or Manager): may edit at ANY status (including
 *    FINANCE_APPROVED/locked) WITHOUT changing the status; every edit is audited
 *    (PROVISION_EDIT_OVERRIDE).
 *
 * Both override paths preserve provenance: the upsert keeps enteredBy on the
 * original SPOC and stamps lastModifiedBy = the overriding actor.
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
    const isFinanceOverride = FINANCE_APPROVER_ROLES.includes(user.role);
    const isManager = user.role === UserRole.CLINIC_MANAGER;

    // Lock enforcement: a FINANCE_APPROVED submission is editable only by a
    // finance approver (Admin or Manager) as an override (BR-08). Everyone else → 403.
    if (isLocked(status) && !isFinanceOverride) {
      throw new ForbiddenException('This submission is locked');
    }
    // State rules per role:
    //  - finance: any status (lock handled above);
    //  - manager: only their review stage (SUBMITTED / CLINIC_MANAGER_REVIEW);
    //  - SPOC: only SPOC-actionable states.
    if (isManager) {
      if (!MANAGER_REVIEW_STATUSES.includes(status)) {
        throw new ConflictException(`Cannot edit a submission in ${status}`);
      }
    } else if (!isFinanceOverride && !isSpocEditable(status)) {
      throw new ConflictException(`Cannot edit a submission in ${status}`);
    }

    const kind: WriteKind = isFinanceOverride
      ? 'finance-override'
      : isManager
        ? 'manager-override'
        : 'spoc';

    if (items.length > 0) {
      await this.applyEntries(submissionId, user, items, kind, submission.clinicId);
    }

    if (kind === 'spoc') {
      // SPOC save: persisting progress moves NOT_STARTED / SENT_BACK_* → DRAFT.
      await this.workflow.saveDraft(submissionId, user);
    }
    // Manager/finance overrides never change the workflow status (a locked item
    // stays locked); the change is captured by the audit entry written above.

    return this.submissions.getDetail(submissionId, user);
  }

  /** Validate the targets, capture before/after, upsert, then audit the save. */
  private async applyEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
    kind: WriteKind,
    clinicId: string,
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

    // Snapshot the prior values so the audit captures the change.
    const before = await this.prisma.provisionEntry.findMany({
      where: { snapshotId: { in: items.map((i) => i.snapshotId) } },
      select: { snapshotId: true, amount: true },
    });

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

    // One audit row per save. A SPOC's normal save is PROVISION_SAVE (the
    // SAVE_DRAFT transition it triggers is intentionally NOT audited, avoiding a
    // double row); a manager review-stage override is MANAGER_PROVISION_OVERRIDE;
    // a finance (Admin/Manager) BR-08 override is PROVISION_EDIT_OVERRIDE.
    const auditAction =
      kind === 'finance-override'
        ? AuditAction.PROVISION_EDIT_OVERRIDE
        : kind === 'manager-override'
          ? AuditAction.MANAGER_PROVISION_OVERRIDE
          : AuditAction.PROVISION_SAVE;
    await this.audit.record({
      action: auditAction,
      entityType: 'MonthlySubmission',
      entityId: submissionId,
      clinicId,
      oldValue: before.map((b) => ({ snapshotId: b.snapshotId, amount: b.amount.toFixed(2) })),
      newValue: items,
    });
  }
}

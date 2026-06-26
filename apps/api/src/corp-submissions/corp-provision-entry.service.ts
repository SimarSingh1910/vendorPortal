import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CorpSubmissionStatus,
  UserRole,
  type CorpProvisionEntryInput,
  type CorpSubmissionDetail,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import type { RequestUser } from '../auth/request-user';
import { CorpWorkflowService, isCorpLocked, isCorpReviewEditable, isCorpSpocEditable } from './corp-workflow.service';
import { CorpSubmissionsService } from './corp-submissions.service';

/** How an incoming edit is classified — drives the audit action and the draft transition. */
type CorpWriteKind = 'spoc' | 'review-override';

/**
 * Corporate provision data entry (Step C2.2) + approver value override (Step C2.3,
 * BR-C08). Two write paths share this service, both writing the canonical
 * CorpProvisionEntry rows (single source of truth):
 *
 *  - Dept SPOC: partial upsert while the submission is SPOC-actionable; moves it
 *    to DRAFT via the state machine. Every line MUST carry a budget code chosen
 *    from the department's ACTIVE codes (BR-C01/BR-C02). Editing a locked
 *    submission → 403; editing in any other non-actionable state → 409.
 *  - Corporate approver (CORP_FINANCE_MANAGER or FINANCE_ADMIN): may override
 *    values ONLY during their review window (SUBMITTED / FINANCE_MANAGER_REVIEW),
 *    WITHOUT changing the status; every edit is audited old->new
 *    (CORP_PROVISION_EDIT_OVERRIDE). Editing outside that window → 409 (or 403 if
 *    locked — unlock first). They cannot touch masters (a separate, admin-gated
 *    surface), satisfying BR-C07.
 *
 * The override path preserves provenance: the upsert keeps enteredBy on the
 * original SPOC and stamps lastModifiedBy = the overriding approver.
 */
@Injectable()
export class CorpProvisionEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
    private readonly audit: AuditService,
    private readonly workflow: CorpWorkflowService,
    private readonly submissions: CorpSubmissionsService,
  ) {}

  async saveEntries(
    submissionId: string,
    user: RequestUser,
    items: CorpProvisionEntryInput[],
  ): Promise<CorpSubmissionDetail> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, departmentId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!(await this.scope.canAccessDepartment(user, submission.departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }

    const status = submission.status as CorpSubmissionStatus;
    const isApprover = (CORP_FINANCE_APPROVER_ROLES as readonly UserRole[]).includes(user.role);
    const isSpoc = user.role === UserRole.DEPT_SPOC;

    if (!isApprover && !isSpoc) {
      throw new ForbiddenException('Your role cannot edit provision values');
    }

    // Lock enforcement: a FINANCE_APPROVED submission is edited only via the
    // admin unlock flow (Step C2.3), never through a direct save.
    if (isCorpLocked(status)) {
      throw new ForbiddenException('This submission is locked');
    }
    // State rules per role:
    //  - approver: only their review window (SUBMITTED / FINANCE_MANAGER_REVIEW);
    //  - SPOC: only SPOC-actionable states.
    if (isApprover && !isSpoc) {
      if (!isCorpReviewEditable(status)) {
        throw new ConflictException(`Cannot edit a submission in ${status}`);
      }
    } else if (!isCorpSpocEditable(status)) {
      throw new ConflictException(`Cannot edit a submission in ${status}`);
    }

    const kind: CorpWriteKind = isSpoc ? 'spoc' : 'review-override';

    if (items.length > 0) {
      await this.applyEntries(submissionId, submission.departmentId, user, items, kind);
    }

    if (kind === 'spoc') {
      // SPOC save: persisting progress moves NOT_STARTED / SENT_BACK_TO_SPOC → DRAFT.
      await this.workflow.saveDraft(submissionId, user);
    }
    // Approver overrides never change the workflow status; the change is captured
    // by the audit entry written in applyEntries.

    return this.submissions.getDetail(submissionId, user);
  }

  /** Validate snapshot targets + budget codes, capture before/after, upsert, audit. */
  private async applyEntries(
    submissionId: string,
    departmentId: string,
    user: RequestUser,
    items: CorpProvisionEntryInput[],
    kind: CorpWriteKind,
  ): Promise<void> {
    // Every target must be a snapshot head of THIS submission.
    const snaps = await this.prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      select: { id: true },
    });
    const validSnaps = new Set(snaps.map((s) => s.id));
    for (const item of items) {
      if (!validSnaps.has(item.snapshotId)) {
        throw new BadRequestException('Unknown snapshot head for this submission');
      }
    }

    // Every line must reference one of THIS department's ACTIVE budget codes
    // (BR-C01/BR-C02): no free text, no other department's codes, no inactive ones.
    const activeCodes = await this.prisma.corpBudgetCode.findMany({
      where: { departmentId, isActive: true },
      select: { id: true },
    });
    const validCodes = new Set(activeCodes.map((c) => c.id));
    for (const item of items) {
      if (!validCodes.has(item.budgetCodeId)) {
        throw new BadRequestException(
          'Each line must use one of this department’s active budget codes',
        );
      }
    }

    // Snapshot prior values so the audit captures the change (amount + budget code).
    const before = await this.prisma.corpProvisionEntry.findMany({
      where: { snapshotId: { in: items.map((i) => i.snapshotId) } },
      select: { snapshotId: true, amount: true, budgetCodeId: true },
    });

    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.corpProvisionEntry.upsert({
          where: { snapshotId: item.snapshotId },
          update: {
            amount: item.amount,
            budgetCodeId: item.budgetCodeId,
            lastModifiedById: user.id,
          },
          create: {
            submissionId,
            snapshotId: item.snapshotId,
            budgetCodeId: item.budgetCodeId,
            amount: item.amount,
            enteredById: user.id,
            lastModifiedById: user.id,
          },
        }),
      ),
    );

    // One audit row per save: a SPOC save is CORP_PROVISION_SAVE (the SAVE_DRAFT
    // transition it triggers is intentionally NOT audited, avoiding a double row);
    // an approver review-window override is CORP_PROVISION_EDIT_OVERRIDE (BR-C08).
    await this.audit.record({
      action:
        kind === 'review-override'
          ? AuditAction.CORP_PROVISION_EDIT_OVERRIDE
          : AuditAction.CORP_PROVISION_SAVE,
      entityType: 'CorpMonthlySubmission',
      entityId: submissionId,
      oldValue: before.map((b) => ({
        snapshotId: b.snapshotId,
        amount: b.amount.toFixed(2),
        budgetCodeId: b.budgetCodeId,
      })),
      newValue: items,
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, CommentAction } from '@prisma/client';
import type { MonthlySubmission } from '@prisma/client';
import { AuditAction, SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/request-user';

const S = SubmissionStatus;

/** The states a SPOC may act on (save / submit). Send-backs return here. */
export const SPOC_ACTIONABLE: SubmissionStatus[] = [
  S.NOT_STARTED,
  S.DRAFT,
  S.SENT_BACK_BY_MANAGER,
  S.SENT_BACK_BY_FINANCE,
];

/** True when a SPOC may still edit provision values for this status. */
export function isSpocEditable(status: SubmissionStatus): boolean {
  return SPOC_ACTIONABLE.includes(status);
}

/**
 * Every workflow action the engine understands. Each maps 1:1 to a controller
 * route; the action name never crosses the API boundary as input, so it stays a
 * backend-local vocabulary (no shared enum needed).
 */
export enum WorkflowAction {
  SAVE_DRAFT = 'SAVE_DRAFT',
  SUBMIT = 'SUBMIT',
  MANAGER_OPEN_REVIEW = 'MANAGER_OPEN_REVIEW',
  MANAGER_APPROVE = 'MANAGER_APPROVE',
  MANAGER_SEND_BACK = 'MANAGER_SEND_BACK',
  FINANCE_OPEN_REVIEW = 'FINANCE_OPEN_REVIEW',
  FINANCE_APPROVE = 'FINANCE_APPROVE',
  FINANCE_SEND_BACK = 'FINANCE_SEND_BACK',
}

interface TransitionDef {
  /** States from which this action is legal. */
  from: SubmissionStatus[];
  /** Resulting state. */
  to: SubmissionStatus;
  /** Roles permitted to perform it (re-checked here, not just at the guard). */
  roles: UserRole[];
  /** A non-empty comment is mandatory (send-backs). */
  requiresComment?: boolean;
  /** Enforce BR-03 (every snapshot head explicitly valued) before transitioning. */
  requiresAllValued?: boolean;
  /** If a comment is recorded, store it under this action type. */
  commentAction?: CommentAction;
  /** Extra fields to stamp on the submission (review/approval/lock timestamps). */
  stamp?: (now: Date, userId: string) => Prisma.MonthlySubmissionUncheckedUpdateInput;
}

/**
 * The authoritative submission state machine (Step 5.2). It is the single owner
 * of every status transition. For each action it validates, in order:
 *   1. the submission exists,
 *   2. the acting role is permitted (re-checked beyond the HTTP RolesGuard),
 *   3. the clinic is in the actor's scope (re-checked beyond ClinicScopeGuard;
 *      finance roles have org-wide access),
 *   4. the current status allows the action,
 *   5. action-specific rules (comment required, BR-03 satisfied).
 * The actual write uses a conditional updateMany on the from-states inside a
 * transaction, so concurrent transitions can't both win (race-safe).
 *
 * BR-04 is structural, not a special case: the ONLY way forward from
 * SENT_BACK_BY_FINANCE is SPOC resubmit -> SUBMITTED -> CLINIC_MANAGER_REVIEW.
 * There is no transition from SUBMITTED straight to FINANCE_REVIEW, so a finance
 * send-back always re-routes through Manager approval before Finance sees it again.
 */
@Injectable()
export class WorkflowService {
  private readonly transitions: Record<WorkflowAction, TransitionDef> = {
    [WorkflowAction.SAVE_DRAFT]: {
      from: SPOC_ACTIONABLE,
      to: S.DRAFT,
      roles: [UserRole.CLINIC_SPOC],
    },
    [WorkflowAction.SUBMIT]: {
      from: SPOC_ACTIONABLE,
      to: S.SUBMITTED,
      roles: [UserRole.CLINIC_SPOC],
      requiresAllValued: true,
      stamp: (now) => ({ submittedAt: now }),
    },
    [WorkflowAction.MANAGER_OPEN_REVIEW]: {
      from: [S.SUBMITTED],
      to: S.CLINIC_MANAGER_REVIEW,
      roles: [UserRole.CLINIC_MANAGER],
      stamp: (now, userId) => ({ reviewStartedAt: now, reviewStartedById: userId }),
    },
    [WorkflowAction.MANAGER_APPROVE]: {
      from: [S.CLINIC_MANAGER_REVIEW],
      to: S.CLINIC_APPROVED,
      roles: [UserRole.CLINIC_MANAGER],
      commentAction: CommentAction.APPROVED,
      stamp: (now) => ({ approvedByManagerAt: now }),
    },
    [WorkflowAction.MANAGER_SEND_BACK]: {
      from: [S.CLINIC_MANAGER_REVIEW],
      to: S.SENT_BACK_BY_MANAGER,
      roles: [UserRole.CLINIC_MANAGER],
      requiresComment: true,
      commentAction: CommentAction.SENT_BACK,
    },
    [WorkflowAction.FINANCE_OPEN_REVIEW]: {
      from: [S.CLINIC_APPROVED],
      to: S.FINANCE_REVIEW,
      roles: [UserRole.FINANCE_ADMIN],
      stamp: (now, userId) => ({ reviewStartedAt: now, reviewStartedById: userId }),
    },
    [WorkflowAction.FINANCE_APPROVE]: {
      from: [S.FINANCE_REVIEW],
      to: S.FINANCE_APPROVED,
      roles: [UserRole.FINANCE_ADMIN],
      commentAction: CommentAction.APPROVED,
      // FINANCE_APPROVED == locked.
      stamp: (now) => ({ approvedByFinanceAt: now, lockedAt: now }),
    },
    [WorkflowAction.FINANCE_SEND_BACK]: {
      from: [S.FINANCE_REVIEW],
      to: S.SENT_BACK_BY_FINANCE,
      roles: [UserRole.FINANCE_ADMIN],
      requiresComment: true,
      commentAction: CommentAction.SENT_BACK,
    },
  };

  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Public action surface (one method per route) ────────────────────────────

  /** SPOC: persist data-entry progress, moving the cycle into DRAFT. */
  saveDraft(submissionId: string, user: RequestUser): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.SAVE_DRAFT, submissionId, user);
  }

  /** SPOC: submit for manager review (requires BR-03). */
  submit(submissionId: string, user: RequestUser): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.SUBMIT, submissionId, user);
  }

  /** Manager: open a submitted item (stamps reviewStartedAt/ById). */
  managerOpenReview(submissionId: string, user: RequestUser): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.MANAGER_OPEN_REVIEW, submissionId, user);
  }

  managerApprove(
    submissionId: string,
    user: RequestUser,
    comment?: string,
  ): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.MANAGER_APPROVE, submissionId, user, comment);
  }

  managerSendBack(
    submissionId: string,
    user: RequestUser,
    comment: string,
  ): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.MANAGER_SEND_BACK, submissionId, user, comment);
  }

  /** Finance: open a clinic-approved item (stamps reviewStartedAt/ById). */
  financeOpenReview(submissionId: string, user: RequestUser): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.FINANCE_OPEN_REVIEW, submissionId, user);
  }

  /** Finance: approve and LOCK. */
  financeApprove(
    submissionId: string,
    user: RequestUser,
    comment?: string,
  ): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.FINANCE_APPROVE, submissionId, user, comment);
  }

  financeSendBack(
    submissionId: string,
    user: RequestUser,
    comment: string,
  ): Promise<MonthlySubmission> {
    return this.run(WorkflowAction.FINANCE_SEND_BACK, submissionId, user, comment);
  }

  /**
   * Unlock a FINANCE_APPROVED submission for correction (FR-06, Step 8.3). Finance
   * Admin only; a non-empty reason is mandatory. Moves it back to FINANCE_REVIEW,
   * clears lockedAt, stores the reason on the submission, and audit-logs the
   * unlock (actor + timestamp). The admin then corrects (override edit) and
   * re-approves to re-lock.
   */
  async financeUnlock(
    submissionId: string,
    user: RequestUser,
    reason: string,
  ): Promise<MonthlySubmission> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, clinicId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (user.role !== UserRole.FINANCE_ADMIN) {
      throw new ForbiddenException('Only a Finance Admin can unlock a submission');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    if ((submission.status as SubmissionStatus) !== S.FINANCE_APPROVED) {
      throw new ConflictException('Only an approved (locked) submission can be unlocked');
    }
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException('A reason is required to unlock a submission');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.monthlySubmission.updateMany({
        where: { id: submissionId, status: S.FINANCE_APPROVED },
        data: {
          status: S.FINANCE_REVIEW,
          unlockedReason: trimmedReason,
          unlockedById: user.id,
          lockedAt: null,
          // Back in review by the unlocking admin.
          reviewStartedAt: now,
          reviewStartedById: user.id,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('Submission changed state concurrently; retry');
      }
      return tx.monthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });

    await this.audit.record({
      action: AuditAction.UNLOCK,
      entityType: 'MonthlySubmission',
      entityId: submissionId,
      clinicId: submission.clinicId,
      oldValue: { status: S.FINANCE_APPROVED },
      newValue: { status: S.FINANCE_REVIEW, reason: trimmedReason },
    });

    return updated;
  }

  // ── Engine ──────────────────────────────────────────────────────────────────

  private async run(
    action: WorkflowAction,
    submissionId: string,
    user: RequestUser,
    comment?: string,
  ): Promise<MonthlySubmission> {
    const def = this.transitions[action];

    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, clinicId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // (b) permission: role then clinic scope (finance short-circuits to org-wide).
    if (!def.roles.includes(user.role)) {
      throw new ForbiddenException('Your role cannot perform this action');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }

    // (a) current status allows it.
    if (!def.from.includes(submission.status as SubmissionStatus)) {
      throw new ConflictException(
        `Action not allowed from status ${submission.status}`,
      );
    }

    const trimmedComment = comment?.trim();
    if (def.requiresComment && !trimmedComment) {
      throw new BadRequestException('A comment is required to send a submission back');
    }

    if (def.requiresAllValued) {
      await this.assertAllHeadsValued(submissionId);
    }

    const now = new Date();
    const data: Prisma.MonthlySubmissionUncheckedUpdateInput = {
      status: def.to,
      ...(def.stamp ? def.stamp(now, user.id) : {}),
    };

    const fromStatus = submission.status as SubmissionStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on the from-states so two racing transitions can't both win.
      const result = await tx.monthlySubmission.updateMany({
        where: { id: submissionId, status: { in: def.from } },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException('Submission changed state concurrently; retry');
      }

      if (def.commentAction && trimmedComment) {
        await tx.submissionComment.create({
          data: {
            submissionId,
            comment: trimmedComment,
            commentedById: user.id,
            roleAtTime: user.role,
            action: def.commentAction,
          },
        });
      }

      return tx.monthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });

    // Audit every real transition. SAVE_DRAFT is excluded — the value-save it
    // accompanies is audited once by ProvisionEntryService (no double row).
    if (action !== WorkflowAction.SAVE_DRAFT) {
      await this.audit.record({
        action: `SUBMISSION_${action}`,
        entityType: 'MonthlySubmission',
        entityId: submissionId,
        clinicId: submission.clinicId,
        oldValue: { status: fromStatus },
        newValue: { status: def.to },
      });
    }

    this.emitNotificationHook(action, updated);
    return updated;
  }

  /**
   * Notification hook (wired in Phase 10: AWS SES + in-app SSE). Each transition
   * notifies the next actor — most importantly a SUBMIT notifies the clinic's
   * Manager that an item awaits review. For now it only logs the intent so the
   * call sites exist and are exercised by tests.
   */
  private emitNotificationHook(action: WorkflowAction, submission: MonthlySubmission): void {
    const recipients: Partial<Record<WorkflowAction, string>> = {
      [WorkflowAction.SUBMIT]: 'CLINIC_MANAGER (review pending)',
      [WorkflowAction.MANAGER_APPROVE]: 'FINANCE (clinic approved)',
      [WorkflowAction.MANAGER_SEND_BACK]: 'CLINIC_SPOC (sent back by manager)',
      [WorkflowAction.FINANCE_SEND_BACK]: 'CLINIC_SPOC (sent back by finance)',
      [WorkflowAction.FINANCE_APPROVE]: 'CLINIC_SPOC + CLINIC_MANAGER (approved & locked)',
    };
    const target = recipients[action];
    if (target) {
      this.logger.log(
        `notify[${target}] for submission ${submission.id} (${submission.clinicId}/${submission.month})`,
      );
    }
  }

  /**
   * BR-03: a submission may be SUBMITTED only when every snapshot head has an
   * explicitly entered value (0 is valid; blank is not). A submission with no
   * mapped heads has nothing to provision and cannot be submitted.
   */
  private async assertAllHeadsValued(submissionId: string): Promise<void> {
    const total = await this.prisma.submissionExpenseHeadSnapshot.count({
      where: { submissionId },
    });
    if (total === 0) {
      throw new UnprocessableEntityException(
        'Cannot submit: no expense heads are mapped for this clinic',
      );
    }
    const missing = await this.prisma.submissionExpenseHeadSnapshot.count({
      where: { submissionId, entry: { is: null } },
    });
    if (missing > 0) {
      throw new UnprocessableEntityException(
        `Cannot submit: ${missing} expense head(s) have no value entered`,
      );
    }
  }
}

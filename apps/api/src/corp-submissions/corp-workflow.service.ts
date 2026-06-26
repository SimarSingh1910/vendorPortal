import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, CommentAction } from '@prisma/client';
import type { CorpMonthlySubmission } from '@prisma/client';
import { AuditAction, CorpDepartmentType, CorpSubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { Sec24AllocationService } from './sec24-allocation.service';
import type { RequestUser } from '../auth/request-user';

const S = CorpSubmissionStatus;

/** States a dept SPOC may act on (save / submit). The single send-back returns here. */
export const CORP_SPOC_ACTIONABLE: CorpSubmissionStatus[] = [
  S.NOT_STARTED,
  S.DRAFT,
  S.SENT_BACK_TO_SPOC,
];

/** True when a dept SPOC may still edit provision values for this status. */
export function isCorpSpocEditable(status: CorpSubmissionStatus): boolean {
  return CORP_SPOC_ACTIONABLE.includes(status);
}

/**
 * States in which a corporate approver owns the submission and may override
 * values (BR-C08): while it is SUBMITTED or under FINANCE_MANAGER_REVIEW.
 */
export const CORP_REVIEW_EDITABLE: CorpSubmissionStatus[] = [S.SUBMITTED, S.FINANCE_MANAGER_REVIEW];

/** True when a corporate approver may override values for this status. */
export function isCorpReviewEditable(status: CorpSubmissionStatus): boolean {
  return CORP_REVIEW_EDITABLE.includes(status);
}

/** A FINANCE_APPROVED corporate submission is locked. */
export function isCorpLocked(status: CorpSubmissionStatus): boolean {
  return status === S.FINANCE_APPROVED;
}

/**
 * Every corporate workflow action. Each maps 1:1 to a controller route; the
 * action name never crosses the API boundary as input (backend-local vocabulary).
 */
export enum CorpWorkflowAction {
  SAVE_DRAFT = 'SAVE_DRAFT',
  SUBMIT = 'SUBMIT',
  OPEN_REVIEW = 'OPEN_REVIEW',
  APPROVE = 'APPROVE',
  SEND_BACK = 'SEND_BACK',
}

interface CorpTransitionDef {
  from: CorpSubmissionStatus[];
  to: CorpSubmissionStatus;
  roles: UserRole[];
  requiresComment?: boolean;
  requiresAllValued?: boolean;
  commentAction?: CommentAction;
  stamp?: (now: Date) => Prisma.CorpMonthlySubmissionUncheckedUpdateInput;
  conflictMessage?: string;
}

/**
 * The authoritative corporate submission state machine (Step C2.2) — its OWN
 * service following the clinic engine's PATTERN (conditional updateMany for
 * optimistic concurrency + in-transaction comments), NOT a fork. It owns every
 * corporate status transition. For each action it validates, in order:
 *   1. the submission exists,
 *   2. the acting role is permitted (beyond the HTTP RolesGuard),
 *   3. the department is in the actor's scope (approvers have org-wide access),
 *   4. the current status allows the action,
 *   5. action-specific rules (comment required, BR-C16 all-valued).
 *
 * 2-level lifecycle, no intermediate approver:
 *   NOT_STARTED -> DRAFT -> SUBMITTED -> FINANCE_MANAGER_REVIEW -> FINANCE_APPROVED (locked)
 *   FINANCE_MANAGER_REVIEW -> SENT_BACK_TO_SPOC -> (SPOC revises) -> SUBMITTED
 *
 * There is no transition that skips FINANCE_MANAGER_REVIEW: approve/send-back are
 * legal only from FINANCE_MANAGER_REVIEW, so a resubmit always re-enters the
 * approver's queue at SUBMITTED and is re-opened before it can be approved.
 */
@Injectable()
export class CorpWorkflowService {
  private readonly transitions: Record<CorpWorkflowAction, CorpTransitionDef> = {
    [CorpWorkflowAction.SAVE_DRAFT]: {
      from: CORP_SPOC_ACTIONABLE,
      to: S.DRAFT,
      roles: [UserRole.DEPT_SPOC],
    },
    [CorpWorkflowAction.SUBMIT]: {
      from: CORP_SPOC_ACTIONABLE,
      to: S.SUBMITTED,
      roles: [UserRole.DEPT_SPOC],
      requiresAllValued: true,
      // Optional SPOC note → one timeline comment in the submit transaction.
      commentAction: CommentAction.SUBMITTED,
      stamp: (now) => ({ submittedAt: now }),
    },
    [CorpWorkflowAction.OPEN_REVIEW]: {
      from: [S.SUBMITTED],
      to: S.FINANCE_MANAGER_REVIEW,
      roles: [...CORP_FINANCE_APPROVER_ROLES],
    },
    [CorpWorkflowAction.APPROVE]: {
      from: [S.FINANCE_MANAGER_REVIEW],
      to: S.FINANCE_APPROVED,
      roles: [...CORP_FINANCE_APPROVER_ROLES],
      commentAction: CommentAction.APPROVED,
      // FINANCE_APPROVED == locked.
      stamp: (now) => ({ financeApprovedAt: now, lockedAt: now }),
    },
    [CorpWorkflowAction.SEND_BACK]: {
      from: [S.FINANCE_MANAGER_REVIEW],
      to: S.SENT_BACK_TO_SPOC,
      roles: [...CORP_FINANCE_APPROVER_ROLES],
      requiresComment: true,
      commentAction: CommentAction.SENT_BACK,
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
    private readonly audit: AuditService,
    private readonly sec24: Sec24AllocationService,
  ) {}

  // ── Public action surface (one method per route) ────────────────────────────

  /** Dept SPOC: persist data-entry progress, moving the cycle into DRAFT. */
  saveDraft(submissionId: string, user: RequestUser): Promise<CorpMonthlySubmission> {
    return this.run(CorpWorkflowAction.SAVE_DRAFT, submissionId, user);
  }

  /** Dept SPOC: submit for approver review (requires BR-C16). Optional note → timeline. */
  submit(submissionId: string, user: RequestUser, comment?: string): Promise<CorpMonthlySubmission> {
    return this.run(CorpWorkflowAction.SUBMIT, submissionId, user, comment);
  }

  /** Corporate approver: open a submitted item for review. */
  openReview(submissionId: string, user: RequestUser): Promise<CorpMonthlySubmission> {
    return this.run(CorpWorkflowAction.OPEN_REVIEW, submissionId, user);
  }

  /** Corporate approver: approve and LOCK. */
  approve(submissionId: string, user: RequestUser, comment?: string): Promise<CorpMonthlySubmission> {
    return this.run(CorpWorkflowAction.APPROVE, submissionId, user, comment);
  }

  /** Corporate approver: send back to the dept SPOC with a mandatory comment. */
  sendBack(submissionId: string, user: RequestUser, comment: string): Promise<CorpMonthlySubmission> {
    return this.run(CorpWorkflowAction.SEND_BACK, submissionId, user, comment);
  }

  /**
   * Unlock a FINANCE_APPROVED submission for correction. FINANCE_ADMIN ONLY
   * (distinct from clinic, where finance managers may also unlock); a non-empty
   * reason is mandatory and audited. Moves it back to FINANCE_MANAGER_REVIEW and
   * clears lockedAt/financeApprovedAt; the approver then corrects (override edit)
   * and re-approves to re-lock.
   */
  async unlock(
    submissionId: string,
    user: RequestUser,
    reason: string,
  ): Promise<CorpMonthlySubmission> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, departmentId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (user.role !== UserRole.FINANCE_ADMIN) {
      throw new ForbiddenException('Only Finance Admin can unlock a submission');
    }
    if ((submission.status as CorpSubmissionStatus) !== S.FINANCE_APPROVED) {
      throw new ConflictException('Only an approved (locked) submission can be unlocked');
    }
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException('A reason is required to unlock a submission');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.corpMonthlySubmission.updateMany({
        where: { id: submissionId, status: S.FINANCE_APPROVED },
        data: {
          status: S.FINANCE_MANAGER_REVIEW,
          lockedAt: null,
          financeApprovedAt: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('Submission changed state concurrently; retry');
      }
      return tx.corpMonthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });

    await this.audit.record({
      action: AuditAction.CORP_UNLOCK,
      entityType: 'CorpMonthlySubmission',
      entityId: submissionId,
      oldValue: { status: S.FINANCE_APPROVED },
      newValue: { status: S.FINANCE_MANAGER_REVIEW, reason: trimmedReason },
    });

    return updated;
  }

  // ── Engine ──────────────────────────────────────────────────────────────────

  private async run(
    action: CorpWorkflowAction,
    submissionId: string,
    user: RequestUser,
    comment?: string,
  ): Promise<CorpMonthlySubmission> {
    const def = this.transitions[action];

    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, departmentId: true, month: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // permission: role then department scope (approvers short-circuit to org-wide).
    if (!def.roles.includes(user.role)) {
      throw new ForbiddenException('Your role cannot perform this action');
    }
    if (!(await this.scope.canAccessDepartment(user, submission.departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }

    // current status allows it.
    if (!def.from.includes(submission.status as CorpSubmissionStatus)) {
      throw new ConflictException(
        def.conflictMessage ?? `Action not allowed from status ${submission.status}`,
      );
    }

    const trimmedComment = comment?.trim();
    if (def.requiresComment && !trimmedComment) {
      throw new BadRequestException('A comment is required to send a submission back');
    }

    if (def.requiresAllValued) {
      await this.assertAllHeadsValued(submissionId);
    }

    // BR-C05: approving the single Sec 24 SHARED_COST_POOL department snapshots the
    // active allocation % onto the submission (stable history even if the % later
    // changes) and freezes each line's HCL Avitas share from that %. Resolved here,
    // applied atomically inside the approve transaction below. null when no % is
    // set yet — amounts were still allowed, the share just stays "—" (BR-C03/C04).
    let sec24Snapshot: { pct: Prisma.Decimal | null } | null = null;
    if (action === CorpWorkflowAction.APPROVE) {
      const department = await this.prisma.corpDepartment.findUnique({
        where: { id: submission.departmentId },
        select: { type: true },
      });
      if (department?.type === CorpDepartmentType.SHARED_COST_POOL) {
        sec24Snapshot = { pct: await this.sec24.activePctForMonth(submission.month) };
      }
    }

    const now = new Date();
    const data: Prisma.CorpMonthlySubmissionUncheckedUpdateInput = {
      status: def.to,
      ...(def.stamp ? def.stamp(now) : {}),
      ...(sec24Snapshot ? { sec24PctSnapshot: sec24Snapshot.pct } : {}),
    };

    const fromStatus = submission.status as CorpSubmissionStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on the from-states so two racing transitions can't both win.
      const result = await tx.corpMonthlySubmission.updateMany({
        where: { id: submissionId, status: { in: def.from } },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException(
          def.conflictMessage ?? 'Submission changed state concurrently; retry',
        );
      }

      if (def.commentAction && trimmedComment) {
        await tx.corpSubmissionComment.create({
          data: {
            submissionId,
            comment: trimmedComment,
            commentedById: user.id,
            roleAtTime: user.role,
            action: def.commentAction,
          },
        });
      }

      // Freeze each line's HCL Avitas share from the snapshot % (atomic with lock).
      if (sec24Snapshot) {
        const entries = await tx.corpProvisionEntry.findMany({
          where: { submissionId },
          select: { id: true, amount: true },
        });
        for (const entry of entries) {
          await tx.corpProvisionEntry.update({
            where: { id: entry.id },
            data: { hclAvitasShare: this.sec24.computeShare(entry.amount, sec24Snapshot.pct) },
          });
        }
      }

      return tx.corpMonthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });

    // Audit every real transition. SAVE_DRAFT is excluded — the value-save it
    // accompanies is audited once by CorpProvisionEntryService (no double row).
    if (action !== CorpWorkflowAction.SAVE_DRAFT) {
      await this.audit.record({
        action: `CORP_SUBMISSION_${action}`,
        entityType: 'CorpMonthlySubmission',
        entityId: submissionId,
        oldValue: { status: fromStatus },
        newValue: {
          status: def.to,
          ...(sec24Snapshot
            ? { sec24PctSnapshot: sec24Snapshot.pct ? sec24Snapshot.pct.toFixed(2) : null }
            : {}),
        },
      });
    }

    return updated;
  }

  /**
   * BR-C16: a submission may be SUBMITTED only when every snapshot head has a
   * complete line (a budget code AND a value; 0 is valid, blank is not). Since a
   * CorpProvisionEntry always carries a mandatory budget code, "has an entry"
   * already implies "has a budget code"; the count of heads without an entry is
   * the count of incomplete lines. A submission with no active heads has nothing
   * to provision and cannot be submitted.
   */
  private async assertAllHeadsValued(submissionId: string): Promise<void> {
    const total = await this.prisma.corpSubmissionExpenseHeadSnapshot.count({
      where: { submissionId },
    });
    if (total === 0) {
      throw new UnprocessableEntityException(
        'Cannot submit: no active expense heads for this department',
      );
    }
    const missing = await this.prisma.corpSubmissionExpenseHeadSnapshot.count({
      where: { submissionId, entry: { is: null } },
    });
    if (missing > 0) {
      throw new UnprocessableEntityException(
        `Cannot submit: ${missing} expense head(s) have no budget code and value entered`,
      );
    }
  }
}

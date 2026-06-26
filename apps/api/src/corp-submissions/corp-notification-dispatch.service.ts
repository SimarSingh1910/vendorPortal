import { Injectable, Logger } from '@nestjs/common';
import type { CorpMonthlySubmission } from '@prisma/client';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Corporate in-app notification `type` tags (Step C5.1). Distinct strings from the
 * clinic set so the web tray can group / icon them; not a shared enum (they never
 * cross the API as input).
 */
export const CorpNotificationType = {
  CORP_CYCLE_OPENED: 'CORP_CYCLE_OPENED',
  CORP_DEPT_NO_HEADS: 'CORP_DEPT_NO_HEADS',
  CORP_PRE_CUTOFF_REMINDER: 'CORP_PRE_CUTOFF_REMINDER',
  CORP_SUBMISSION_SUBMITTED: 'CORP_SUBMISSION_SUBMITTED',
  CORP_SUBMISSION_APPROVED: 'CORP_SUBMISSION_APPROVED',
  CORP_SUBMISSION_SENT_BACK: 'CORP_SUBMISSION_SENT_BACK',
} as const;

const EMAIL_PREFIX = 'Cost Provision Portal';

/** The corp-submission fields a dispatch needs (full rows satisfy this). */
type CorpSubmissionRef = Pick<CorpMonthlySubmission, 'id' | 'departmentId' | 'month'>;

/** Render a date as an IST (Asia/Kolkata) calendar day, e.g. "16 Jun 2026". */
function istDay(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * The single corporate notification path (Step C5.1). Each corporate workflow /
 * scheduler event maps to one method here, which resolves the exact recipient set
 * and fans the message out on BOTH channels (in-app + email) via the EXISTING
 * NotificationService.create — the same notifier the clinic side uses, never a
 * parallel one. The clinic NotificationDispatchService is untouched.
 *
 * Notification.submissionId FK references the clinic MonthlySubmission, so corp
 * notifications carry submissionId = null and put the department + month in the
 * message instead (a corp deep-link would need a separate column — out of scope).
 *
 * Recipient resolution always excludes inactive users and respects department
 * assignment, so access changes (deactivation / re-scoping) take effect here too.
 * Dispatch is best-effort: a failed notification is logged, never propagated.
 */
@Injectable()
export class CorpNotificationDispatchService {
  private readonly logger = new Logger(CorpNotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Cycle opened → the department's active Dept SPOCs ───────────────────────
  async cycleOpened(submission: CorpSubmissionRef): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.deptSpocIds(submission.departmentId);
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_CYCLE_OPENED,
      message: `The ${submission.month} cost-provision cycle for ${dept} is now open. Please complete and submit your estimate.`,
      emailSubject: `${EMAIL_PREFIX} — ${submission.month} cycle open for ${dept}`,
    });
  }

  /**
   * Operational flag: a department opened with zero active expense heads has an
   * empty form and cannot submit — alert the Finance Admin(s), who own corporate
   * master data (CORP_FINANCE_MANAGER cannot edit masters, so it is not them).
   */
  async deptHasNoHeads(submission: CorpSubmissionRef): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.roleIds(UserRole.FINANCE_ADMIN);
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_DEPT_NO_HEADS,
      message: `${dept} opened the ${submission.month} cycle with no active expense heads. Add heads so the department can submit.`,
      emailSubject: `${EMAIL_PREFIX} — ${dept} has no expense heads (${submission.month})`,
    });
  }

  // ── Pre-cutoff reminder → the department's SPOCs (still NOT_STARTED/DRAFT) ───
  async preCutoffReminder(submission: CorpSubmissionRef, cutoffDate: Date | null): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.deptSpocIds(submission.departmentId);
    const due = cutoffDate ? ` It is due by ${istDay(cutoffDate)}.` : '';
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_PRE_CUTOFF_REMINDER,
      message: `Reminder: the ${submission.month} cost-provision submission for ${dept} has not been completed yet.${due}`,
      emailSubject: `${EMAIL_PREFIX} — reminder: ${dept} ${submission.month} submission pending`,
    });
  }

  // ── SPOC submits → the Corporate Finance Manager(s) ─────────────────────────
  async submitted(submission: CorpSubmissionRef): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.roleIds(UserRole.CORP_FINANCE_MANAGER);
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_SUBMISSION_SUBMITTED,
      message: `${dept}'s ${submission.month} submission has been submitted and is awaiting corporate finance review.`,
      emailSubject: `${EMAIL_PREFIX} — ${dept} ${submission.month} awaiting your review`,
    });
  }

  // ── Approver approves & locks → the department's SPOCs ──────────────────────
  async approved(submission: CorpSubmissionRef): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.deptSpocIds(submission.departmentId);
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_SUBMISSION_APPROVED,
      message: `The ${submission.month} submission for ${dept} was approved by corporate finance and is now locked.`,
      emailSubject: `${EMAIL_PREFIX} — ${dept} ${submission.month} approved & locked`,
    });
  }

  // ── Approver sends back → the department's SPOCs, with the comment ──────────
  async sentBack(submission: CorpSubmissionRef, comment: string): Promise<void> {
    const dept = await this.departmentName(submission.departmentId);
    const recipients = await this.deptSpocIds(submission.departmentId);
    await this.fanOut(recipients, {
      type: CorpNotificationType.CORP_SUBMISSION_SENT_BACK,
      message: `Your ${submission.month} submission for ${dept} was sent back by corporate finance. Reason: "${comment}"`,
      emailSubject: `${EMAIL_PREFIX} — ${dept} ${submission.month} sent back`,
    });
  }

  // ── Recipient resolution ────────────────────────────────────────────────────

  /** Active Dept SPOCs assigned to this department (multi-dept SPOCs included). */
  private async deptSpocIds(departmentId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: UserRole.DEPT_SPOC,
        departmentAssignments: { some: { departmentId } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Every active user with the given role (org-wide; not department-scoped). */
  private async roleIds(role: UserRole): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async departmentName(departmentId: string): Promise<string> {
    const dept = await this.prisma.corpDepartment.findUnique({
      where: { id: departmentId },
      select: { name: true },
    });
    return dept?.name ?? 'your department';
  }

  /** Deliver one payload to each recipient on both channels; isolate failures. */
  private async fanOut(
    userIds: string[],
    payload: { type: string; message: string; emailSubject: string },
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.create({
          userId,
          type: payload.type,
          message: payload.message,
          emailSubject: payload.emailSubject,
          // Corp notifications cannot link via submissionId (FK is the clinic table).
          submissionId: null,
        });
      } catch (err) {
        this.logger.error(
          `corp dispatch failed for user ${userId} (${payload.type}): ${(err as Error).message}`,
        );
      }
    }
  }
}

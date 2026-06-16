import { Injectable, Logger } from '@nestjs/common';
import type { MonthlySubmission } from '@prisma/client';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

/**
 * In-app notification `type` tags. Stable strings so the web tray can group /
 * icon them; not a shared enum because they never cross the API as input.
 */
export const NotificationType = {
  CYCLE_OPENED: 'CYCLE_OPENED',
  CLINIC_NO_HEADS: 'CLINIC_NO_HEADS',
  PRE_CUTOFF_REMINDER: 'PRE_CUTOFF_REMINDER',
  SUBMISSION_SUBMITTED: 'SUBMISSION_SUBMITTED',
  MANAGER_APPROVED: 'MANAGER_APPROVED',
  MANAGER_SENT_BACK: 'MANAGER_SENT_BACK',
  FINANCE_APPROVED: 'FINANCE_APPROVED',
  FINANCE_SENT_BACK: 'FINANCE_SENT_BACK',
} as const;

const EMAIL_PREFIX = 'Cost Provision Portal';

/** The submission fields a dispatch needs (full rows satisfy this). */
type SubmissionRef = Pick<MonthlySubmission, 'id' | 'clinicId' | 'month'>;

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
 * The single notification path (Step 10.3). Each workflow / scheduler event maps
 * to one method here, which resolves the exact recipient set and fans the message
 * out on BOTH channels (in-app + email) via NotificationService.create — the
 * `emailSubject` is what drives the email channel.
 *
 * This REPLACES the old logging-only `emitNotificationHook`: the workflow engine
 * and the cycle opener call these methods instead. Dispatch is best-effort — a
 * failed notification is logged and never propagates to break the workflow
 * transition that triggered it (the caller also wraps the call defensively).
 *
 * Recipient resolution always excludes inactive users and respects clinic
 * assignment, so access changes (deactivation / re-scoping) take effect here too.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Trigger 1: cycle opened → that clinic's active SPOCs ────────────────────
  async cycleOpened(submission: SubmissionRef): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [UserRole.CLINIC_SPOC]);
    await this.fanOut(recipients, {
      type: NotificationType.CYCLE_OPENED,
      submissionId: submission.id,
      message: `The ${submission.month} cost-provision cycle for ${clinic} is now open. Please complete and submit your estimate.`,
      emailSubject: `${EMAIL_PREFIX} — ${submission.month} cycle open for ${clinic}`,
    });
  }

  /**
   * Operational flag (Step 10.4): a clinic opened with zero mapped expense heads
   * has an empty form and cannot submit — alert every Finance Admin to map heads.
   */
  async clinicHasNoHeads(submission: SubmissionRef): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.financeAdminIds();
    await this.fanOut(recipients, {
      type: NotificationType.CLINIC_NO_HEADS,
      submissionId: submission.id,
      message: `${clinic} opened the ${submission.month} cycle with no mapped expense heads. Map heads so the clinic can submit.`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} has no expense heads (${submission.month})`,
    });
  }

  // ── Trigger 2: pre-cutoff reminder → laggard SPOCs + their Managers ─────────
  async preCutoffReminder(submission: SubmissionRef, cutoffDate: Date | null): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [
      UserRole.CLINIC_SPOC,
      UserRole.CLINIC_MANAGER,
    ]);
    const due = cutoffDate ? ` It is due by ${istDay(cutoffDate)}.` : '';
    await this.fanOut(recipients, {
      type: NotificationType.PRE_CUTOFF_REMINDER,
      submissionId: submission.id,
      message: `Reminder: the ${submission.month} cost-provision submission for ${clinic} has not been completed yet.${due}`,
      emailSubject: `${EMAIL_PREFIX} — reminder: ${clinic} ${submission.month} submission pending`,
    });
  }

  // ── Trigger 3: SPOC submits → that clinic's Manager(s) ──────────────────────
  async submitted(submission: SubmissionRef): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [UserRole.CLINIC_MANAGER]);
    await this.fanOut(recipients, {
      type: NotificationType.SUBMISSION_SUBMITTED,
      submissionId: submission.id,
      message: `${clinic}'s ${submission.month} submission has been submitted and is awaiting your review.`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} ${submission.month} awaiting your review`,
    });
  }

  // ── Trigger 4: Manager approves → all Finance Admins ────────────────────────
  async managerApproved(submission: SubmissionRef): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.financeAdminIds();
    await this.fanOut(recipients, {
      type: NotificationType.MANAGER_APPROVED,
      submissionId: submission.id,
      message: `${clinic}'s ${submission.month} submission was approved by the clinic manager and awaits Finance review.`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} ${submission.month} awaiting Finance review`,
    });
  }

  // ── Trigger 5: Manager sends back → that clinic's SPOC(s), with comment ─────
  async managerSentBack(submission: SubmissionRef, comment: string): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [UserRole.CLINIC_SPOC]);
    await this.fanOut(recipients, {
      type: NotificationType.MANAGER_SENT_BACK,
      submissionId: submission.id,
      message: `Your ${submission.month} submission for ${clinic} was sent back by the clinic manager. Reason: "${comment}"`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} ${submission.month} sent back by manager`,
    });
  }

  // ── Trigger 6: Finance approves → that clinic's SPOC(s) + Manager(s) ────────
  async financeApproved(submission: SubmissionRef): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [
      UserRole.CLINIC_SPOC,
      UserRole.CLINIC_MANAGER,
    ]);
    await this.fanOut(recipients, {
      type: NotificationType.FINANCE_APPROVED,
      submissionId: submission.id,
      message: `The ${submission.month} submission for ${clinic} was approved by Finance and is now locked.`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} ${submission.month} approved & locked`,
    });
  }

  // ── Trigger 7: Finance sends back → SPOC(s) + Manager(s), with comment ──────
  async financeSentBack(submission: SubmissionRef, comment: string): Promise<void> {
    const clinic = await this.clinicName(submission.clinicId);
    const recipients = await this.clinicUserIds(submission.clinicId, [
      UserRole.CLINIC_SPOC,
      UserRole.CLINIC_MANAGER,
    ]);
    await this.fanOut(recipients, {
      type: NotificationType.FINANCE_SENT_BACK,
      submissionId: submission.id,
      message: `The ${submission.month} submission for ${clinic} was sent back by Finance. Reason: "${comment}"`,
      emailSubject: `${EMAIL_PREFIX} — ${clinic} ${submission.month} sent back by Finance`,
    });
  }

  // ── Recipient resolution ────────────────────────────────────────────────────

  /** Active users with the given role(s) assigned to this clinic. */
  private async clinicUserIds(clinicId: string, roles: UserRole[]): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: roles }, assignments: { some: { clinicId } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Every active Finance Admin (org-wide; not clinic-scoped). */
  private async financeAdminIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: UserRole.FINANCE_ADMIN },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async clinicName(clinicId: string): Promise<string> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    return clinic?.name ?? 'your clinic';
  }

  /** Deliver one payload to each recipient on both channels; isolate failures. */
  private async fanOut(
    userIds: string[],
    payload: { type: string; message: string; emailSubject: string; submissionId?: string | null },
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.create({
          userId,
          type: payload.type,
          message: payload.message,
          emailSubject: payload.emailSubject,
          submissionId: payload.submissionId ?? null,
        });
      } catch (err) {
        this.logger.error(
          `dispatch failed for user ${userId} (${payload.type}): ${(err as Error).message}`,
        );
      }
    }
  }
}

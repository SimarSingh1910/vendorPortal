import { Injectable, Logger } from '@nestjs/common';
import { Portal } from '@prisma/client';
import {
  AuditAction,
  SUBMISSION_STATUS_LABELS,
  SubmissionStatus,
  reminderKind,
  type SendRemindersResult,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { istDateKey } from './month.util';

/**
 * Finance "Send reminder" (finance dashboard): emails the people each pending
 * submission is waiting on — the SPOCs + cluster managers when the SPOC must act,
 * the cluster managers when it awaits their approval (see `reminderKind`).
 *
 * At most ONE reminder per submission per IST day. The claim is the audit row,
 * written under a row lock on the submission (status re-read there, so a clinic
 * that moved on since the batch began isn't sent a stale message) — two finance
 * users clicking at once can't both send. Every lookup happens BEFORE the claim,
 * so after it only the per-recipient fan-out runs (which isolates its own
 * failures); any other error skips that one clinic instead of the whole batch.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async send(submissionIds: string[], now: Date = new Date()): Promise<SendRemindersResult> {
    const ids = [...new Set(submissionIds)];
    const submissions = await this.prisma.monthlySubmission.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        clinicId: true,
        month: true,
        status: true,
        clinic: { select: { name: true, isActive: true } },
      },
    });
    const byId = new Map(submissions.map((s) => [s.id, s]));
    // Each month's cutoff, for the email's "due by" line — loaded once per batch.
    const configs = await this.prisma.notificationConfig.findMany({
      where: {
        portal: Portal.CLINIC,
        month: { in: [...new Set(submissions.map((s) => s.month))] },
      },
      select: { month: true, cutoffDate: true },
    });
    const cutoffs = new Map(configs.map((c) => [c.month, c.cutoffDate]));
    const today = istDateKey(now);
    const result: SendRemindersResult = { sent: [], skipped: [] };

    for (const id of ids) {
      const s = byId.get(id);
      if (!s) {
        result.skipped.push({ submissionId: id, clinicName: '', reason: 'Submission not found' });
        continue;
      }
      const clinicName = s.clinic.name;
      const skip = (reason: string) =>
        result.skipped.push({ submissionId: id, clinicName, reason });
      try {
        const kind = reminderKind(s.status as SubmissionStatus);
        if (!kind) {
          skip(`Nothing to remind (${SUBMISSION_STATUS_LABELS[s.status as SubmissionStatus]})`);
          continue;
        }
        if (!s.clinic.isActive) {
          skip('Clinic is inactive');
          continue;
        }
        const recipients = await this.dispatch.reminderRecipients(s.clinicId, kind);
        if (recipients.length === 0) {
          skip(
            kind === 'APPROVAL_PENDING'
              ? 'No active cluster manager assigned'
              : 'No active SPOC or cluster manager assigned',
          );
          continue;
        }

        const claim = await this.prisma.$transaction(
          async (tx): Promise<{ skip: string } | { status: SubmissionStatus }> => {
            const [row] = await tx.$queryRaw<Array<{ status: string }>>`
              SELECT status FROM MonthlySubmission WHERE id = ${id} FOR UPDATE`;
            const status = row?.status as SubmissionStatus | undefined;
            if (!status || reminderKind(status) !== kind) {
              const label = status ? SUBMISSION_STATUS_LABELS[status] : 'unknown';
              return { skip: `Status changed to ${label} — refresh and try again` };
            }
            const last = await tx.auditLog.findFirst({
              where: {
                entityType: 'MonthlySubmission',
                entityId: id,
                action: AuditAction.SUBMISSION_REMINDER_SENT,
              },
              orderBy: { performedAt: 'desc' },
              select: { performedAt: true, performedBy: { select: { name: true } } },
            });
            if (last && istDateKey(last.performedAt) === today) {
              return { skip: `Already reminded today by ${last.performedBy?.name ?? 'someone'}` };
            }
            await this.audit.record(
              {
                action: AuditAction.SUBMISSION_REMINDER_SENT,
                entityType: 'MonthlySubmission',
                entityId: id,
                clinicId: s.clinicId,
                newValue: { kind, status, recipients: recipients.length },
              },
              tx,
            );
            return { status };
          },
        );
        if ('skip' in claim) {
          skip(claim.skip);
          continue;
        }

        await this.dispatch.manualReminder(
          { id, clinicId: s.clinicId, month: s.month, status: claim.status },
          kind,
          recipients,
          { clinicName, cutoffDate: cutoffs.get(s.month) ?? null, now },
        );
        result.sent.push({ submissionId: id, clinicName, kind, recipients: recipients.length });
      } catch (err) {
        this.logger.error(`reminder failed for submission ${id}: ${(err as Error).message}`);
        skip('Could not send — please try again');
      }
    }
    return result;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CycleService, type OpenMonthResult } from '../submissions/cycle.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';

const IST_TZ = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST (Asia/Kolkata) calendar day of a Date as 'YYYY-MM-DD' (en-CA = ISO). */
function istDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Statuses that count as "not yet submitted" for the pre-cutoff reminder. */
const LAGGARD_STATUSES = [SubmissionStatus.NOT_STARTED, SubmissionStatus.DRAFT];

/**
 * Cycle scheduler (Step 10.4). A single daily cron (08:00 IST) reads the
 * per-cycle NotificationConfig rows and, comparing IST calendar days:
 *   • on monthStartNotifyDate → auto-opens every active clinic's cycle via the
 *     EXISTING idempotent CycleService (which audits as SYSTEM and, on first
 *     creation, fires the cycle-open + zero-mapped-head notifications);
 *   • on (cutoffDate − preCutoffReminderDays) → reminds laggard SPOCs + Managers.
 *
 * Everything is idempotent: re-opening a month creates no duplicate cycles and,
 * because cycle-open notifications fire only on first creation, no duplicate
 * notifications. The work methods are public so the admin "open now" endpoint and
 * the tests can invoke them directly without waiting for the cron. `now` is a
 * parameter (not a hidden `new Date()`) so the date-gating logic is deterministic
 * under test.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycle: CycleService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  @Cron('0 0 8 * * *', { name: 'cpp-daily-cycle-jobs', timeZone: IST_TZ })
  async runDailyJobs(now: Date = new Date()): Promise<void> {
    const today = istDateKey(now);
    const configs = await this.prisma.notificationConfig.findMany();
    this.logger.log(`daily jobs for IST ${today}: evaluating ${configs.length} cycle config(s)`);

    for (const cfg of configs) {
      try {
        if (istDateKey(cfg.monthStartNotifyDate) === today) {
          await this.openCycleForMonth(cfg.month);
        }
        const reminderDay = new Date(cfg.cutoffDate.getTime() - cfg.preCutoffReminderDays * DAY_MS);
        if (istDateKey(reminderDay) === today) {
          await this.sendReminders(cfg.month);
        }
      } catch (err) {
        this.logger.error(`daily job failed for ${cfg.month}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Open every active clinic's cycle for `month` (idempotent). SPOC notifications
   * and zero-mapped-head flags are emitted inside CycleService on first creation,
   * so re-running this produces no duplicate cycles or notifications.
   */
  async openCycleForMonth(month: string): Promise<OpenMonthResult> {
    const result = await this.cycle.openMonth(month);
    this.logger.log(
      `opened ${month}: ${result.created} new, ${result.alreadyOpen} already open ` +
        `of ${result.activeClinics} active clinic(s)`,
    );
    return result;
  }

  /**
   * Pre-cutoff reminder (Trigger 2): every still-NOT_STARTED/DRAFT submission for
   * the month reminds that clinic's SPOCs + Managers, including the IST cutoff.
   * Returns the number of laggard submissions reminded.
   */
  async sendReminders(month: string): Promise<number> {
    const cfg = await this.prisma.notificationConfig.findUnique({ where: { month } });
    const laggards = await this.prisma.monthlySubmission.findMany({
      where: { month, status: { in: LAGGARD_STATUSES } },
      select: { id: true, clinicId: true, month: true },
    });

    for (const submission of laggards) {
      try {
        await this.dispatch.preCutoffReminder(submission, cfg?.cutoffDate ?? null);
      } catch (err) {
        this.logger.error(`reminder failed for submission ${submission.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`sent ${laggards.length} pre-cutoff reminder(s) for ${month}`);
    return laggards.length;
  }
}

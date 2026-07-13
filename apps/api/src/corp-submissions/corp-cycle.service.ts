import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CorpMonthlySubmission, CorpSubmissionExpenseHeadSnapshot } from '@prisma/client';
import { AuditAction } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpNotificationDispatchService } from './corp-notification-dispatch.service';

/** A corporate submission with its frozen head list, as returned by the open routine. */
export type OpenedCorpSubmission = CorpMonthlySubmission & {
  snapshots: CorpSubmissionExpenseHeadSnapshot[];
};

export interface OpenCorpCycleResult {
  submission: OpenedCorpSubmission;
  /** false when the cycle was already open (idempotent re-run hit an existing row). */
  created: boolean;
}

export interface OpenCorpMonthResult {
  month: string;
  activeDepartments: number;
  created: number;
  alreadyOpen: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Corporate cycle opening (Step C2.1) — the corporate counterpart of the clinic
 * CycleService, following the same pattern but as its OWN service (corporate
 * states/data differ; no fork). This is the ONLY place live master state feeds a
 * corporate submission: when a department/month cycle opens we create the
 * CorpMonthlySubmission and FREEZE that department's currently-active expense
 * heads into CorpSubmissionExpenseHeadSnapshot rows (name as-of-now). Everything
 * downstream reads the snapshot, never the live masters — that is how BR-C11
 * ("masters apply from the NEXT cycle only") is enforced.
 *
 * The open routine is idempotent: re-running for an already-open department/month
 * returns the existing submission and creates no duplicate rows. Idempotency is
 * guarded both by an up-front existence check and by the
 * @@unique([departmentId, month]) constraint (race-safe against the scheduler and
 * an admin re-run firing concurrently). The scheduler (Step C5) reuses openMonth.
 *
 * Corporate notification triggers wire onto this in a later step; cycle opening
 * itself stays side-effect-free beyond the submission + snapshot + audit row.
 */
@Injectable()
export class CorpCycleService {
  private readonly logger = new Logger(CorpCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly corpExpenseHeads: CorpExpenseHeadsService,
    private readonly audit: AuditService,
    // Optional so unit modules that construct CorpCycleService without the
    // notifications wiring keep working; dispatch is a best-effort side path.
    @Optional() private readonly dispatch?: CorpNotificationDispatchService,
  ) {}

  private assertMonth(month: string): void {
    if (!MONTH_RE.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
  }

  /**
   * Open the cycle for one department/month. Idempotent. A department with no
   * active expense heads opens with an empty snapshot (an empty provision form).
   */
  async openDepartmentCycle(departmentId: string, month: string): Promise<OpenCorpCycleResult> {
    this.assertMonth(month);

    // Idempotent fast path: if it's already open, return it untouched —
    // regardless of the department's current active heads (never re-snapshot).
    const existing = await this.findOpened(departmentId, month);
    if (existing) {
      return { submission: existing, created: false };
    }

    // Creating a NEW cycle is only valid for an existing, active department.
    const department = await this.prisma.corpDepartment.findUnique({
      where: { id: departmentId },
      select: { id: true, isActive: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    if (!department.isActive) {
      throw new BadRequestException('Cannot open a cycle for an inactive department');
    }

    // The frozen head set = the department's currently active heads. Reuse the
    // heads service so the snapshot can never drift from the master read.
    const heads = await this.corpExpenseHeads.list(departmentId, 'active');

    try {
      const submission = await this.prisma.corpMonthlySubmission.create({
        data: {
          departmentId,
          month,
          // status defaults to NOT_STARTED in the schema.
          snapshots: {
            create: heads.map((head) => ({
              expenseHeadId: head.id,
              expenseHeadNameAtSnapshot: head.name,
            })),
          },
        },
        include: { snapshots: true },
      });
      // SYSTEM action when invoked by the scheduler (no request context) → null
      // actor + null IP; an admin manual-open carries that admin from the request.
      await this.audit.record({
        action: AuditAction.CORP_CYCLE_OPEN,
        entityType: 'CorpMonthlySubmission',
        entityId: submission.id,
        newValue: { departmentId, month, status: submission.status, snapshotHeads: heads.length },
      });

      // Notify the department's active SPOCs the cycle is open; flag a zero-active-
      // head open to Finance Admins (who own corp masters). Step C5.1/C5.2. Fired
      // only on first creation, so an idempotent re-run never re-notifies. Best-effort.
      if (this.dispatch) {
        try {
          await this.dispatch.cycleOpened(submission);
          if (heads.length === 0) {
            await this.dispatch.deptHasNoHeads(submission);
          }
        } catch (err) {
          this.logger.error(
            `corp cycle-open notification failed for ${submission.id}: ${(err as Error).message}`,
          );
        }
      }

      return { submission, created: true };
    } catch (err) {
      // A concurrent opener won the @@unique([departmentId, month]) race — treat
      // as already-open and return the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findOpened(departmentId, month);
        if (winner) {
          return { submission: winner, created: false };
        }
      }
      throw err;
    }
  }

  /**
   * Open the cycle for EVERY active department for a month (the scheduler's entry
   * point). Each department is opened independently and idempotently, so a partial
   * run can be safely re-run to completion.
   */
  async openMonth(month: string): Promise<OpenCorpMonthResult> {
    this.assertMonth(month);

    const departments = await this.prisma.corpDepartment.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    let created = 0;
    let alreadyOpen = 0;
    for (const department of departments) {
      const result = await this.openDepartmentCycle(department.id, month);
      if (result.created) {
        created += 1;
      } else {
        alreadyOpen += 1;
      }
    }

    return { month, activeDepartments: departments.length, created, alreadyOpen };
  }

  private findOpened(departmentId: string, month: string): Promise<OpenedCorpSubmission | null> {
    return this.prisma.corpMonthlySubmission.findUnique({
      where: { departmentId_month: { departmentId, month } },
      include: { snapshots: true },
    });
  }
}

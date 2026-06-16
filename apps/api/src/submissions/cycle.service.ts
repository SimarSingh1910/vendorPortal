import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MonthlySubmission, SubmissionExpenseHeadSnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@portal/shared';

/** A submission with its frozen head list, as returned by the open routine. */
export type OpenedSubmission = MonthlySubmission & {
  snapshots: SubmissionExpenseHeadSnapshot[];
};

export interface OpenCycleResult {
  submission: OpenedSubmission;
  /** false when the cycle was already open (idempotent re-run hit an existing row). */
  created: boolean;
}

export interface OpenMonthResult {
  month: string;
  activeClinics: number;
  created: number;
  alreadyOpen: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Cycle opening (Step 5.1). This is the ONLY place live master state feeds a
 * submission: when a clinic/month cycle opens we create the MonthlySubmission and
 * FREEZE the clinic's currently mapped, active expense heads into
 * SubmissionExpenseHeadSnapshot rows (name + category as-of-now). Everything
 * downstream reads the snapshot, never the live masters — that is how BR-05
 * ("master changes take effect next cycle only") is enforced.
 *
 * The open routine is idempotent: re-running for an already-open clinic/month
 * returns the existing submission and creates no duplicate rows. Idempotency is
 * guarded both by an up-front existence check and by the
 * @@unique([clinicId, month]) constraint (race-safe against the scheduler and an
 * admin re-run firing concurrently). Invoked by the scheduler (Step 10.4).
 */
@Injectable()
export class CycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicExpenseHeads: ClinicExpenseHeadsService,
    private readonly audit: AuditService,
  ) {}

  private assertMonth(month: string): void {
    if (!MONTH_RE.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
  }

  /**
   * Open the cycle for one clinic/month. Idempotent. A clinic with no active
   * mappings opens with an empty snapshot (an empty provision form).
   */
  async openClinicCycle(clinicId: string, month: string): Promise<OpenCycleResult> {
    this.assertMonth(month);

    // Idempotent fast path: if it's already open, return it untouched —
    // regardless of the clinic's current active state (never re-snapshot).
    const existing = await this.findOpened(clinicId, month);
    if (existing) {
      return { submission: existing, created: false };
    }

    // Creating a NEW cycle is only valid for an existing, active clinic.
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, isActive: true },
    });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }
    if (!clinic.isActive) {
      throw new BadRequestException('Cannot open a cycle for an inactive clinic');
    }

    // The frozen head set = the clinic's currently mapped, active heads. Reuse the
    // single source of "what applies" so the snapshot can never drift from the form.
    const heads = await this.clinicExpenseHeads.listMapped(clinicId);

    try {
      const submission = await this.prisma.monthlySubmission.create({
        data: {
          clinicId,
          month,
          // status defaults to NOT_STARTED in the schema.
          snapshots: {
            create: heads.map((head) => ({
              expenseHeadId: head.expenseHeadId,
              expenseHeadNameAtSnapshot: head.name,
              expenseHeadCategoryAtSnapshot: head.category,
            })),
          },
        },
        include: { snapshots: true },
      });
      // SYSTEM action when invoked by the scheduler (no request context) → null
      // actor + null IP; an admin re-run carries that admin from the request.
      await this.audit.record({
        action: AuditAction.CYCLE_OPEN,
        entityType: 'MonthlySubmission',
        entityId: submission.id,
        clinicId,
        newValue: { month, status: submission.status, snapshotHeads: heads.length },
      });
      return { submission, created: true };
    } catch (err) {
      // A concurrent opener won the @@unique([clinicId, month]) race — treat as
      // already-open and return the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findOpened(clinicId, month);
        if (winner) {
          return { submission: winner, created: false };
        }
      }
      throw err;
    }
  }

  /**
   * Open the cycle for EVERY active clinic for a month (the scheduler's entry
   * point). Each clinic is opened independently and idempotently, so a partial
   * run can be safely re-run to completion.
   */
  async openMonth(month: string): Promise<OpenMonthResult> {
    this.assertMonth(month);

    const clinics = await this.prisma.clinic.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { name: 'asc' },
    });

    let created = 0;
    let alreadyOpen = 0;
    for (const clinic of clinics) {
      const result = await this.openClinicCycle(clinic.id, month);
      if (result.created) {
        created += 1;
      } else {
        alreadyOpen += 1;
      }
    }

    return { month, activeClinics: clinics.length, created, alreadyOpen };
  }

  private findOpened(clinicId: string, month: string): Promise<OpenedSubmission | null> {
    return this.prisma.monthlySubmission.findUnique({
      where: { clinicId_month: { clinicId, month } },
      include: { snapshots: true },
    });
  }
}

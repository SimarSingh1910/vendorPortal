import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MonthlySubmission, SubmissionExpenseHeadSnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { AuditAction } from '@portal/shared';

/** Statuses in which a cycle with no entries may still follow the mapping. */
const RESYNC_STATUSES = ['NOT_STARTED', 'DRAFT'] as const;
type ResyncStatus = (typeof RESYNC_STATUSES)[number];

type MappedHead =Awaited<ReturnType<ClinicExpenseHeadsService['listMapped']>>[number];

/** What it takes to bring a snapshot set in line with the current mapping. */
function snapshotDiff(snapshots: SubmissionExpenseHeadSnapshot[], heads: MappedHead[]) {
  const wanted = new Set(heads.map((h) => h.expenseHeadId));
  const have = new Map(snapshots.map((s) => [s.expenseHeadId, s]));
  return {
    drop: snapshots.filter((s) => !wanted.has(s.expenseHeadId)).map((s) => s.id),
    add: heads.filter((h) => !have.has(h.expenseHeadId)),
    refresh: heads.filter((h) => {
      const s = have.get(h.expenseHeadId);
      return (
        !!s &&
        (s.expenseHeadGlNameAtSnapshot !== h.glAccountName ||
          s.expenseHeadGlNoAtSnapshot !== h.glAccountNo ||
          s.expenseHeadAllowsMultipleVendorsAtSnapshot !== h.allowsMultipleVendors)
      );
    }),
  };
}

const isEmptyDiff = (d: ReturnType<typeof snapshotDiff>): boolean =>
  d.drop.length === 0 && d.add.length === 0 && d.refresh.length === 0;

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
  private readonly logger = new Logger(CycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicExpenseHeads: ClinicExpenseHeadsService,
    private readonly audit: AuditService,
    // Optional so unit modules that construct CycleService without the
    // notifications wiring keep working; dispatch is a best-effort side path.
    @Optional() private readonly dispatch?: NotificationDispatchService,
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
              expenseHeadGlNameAtSnapshot: head.glAccountName,
              expenseHeadGlNoAtSnapshot: head.glAccountNo,
              expenseHeadAllowsMultipleVendorsAtSnapshot: head.allowsMultipleVendors,
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

      // Trigger 1 (Step 10.3): notify the clinic's active SPOCs the cycle is open.
      // Flag a zero-mapped-head open to Finance Admins (Step 10.4). Dispatched only
      // on first creation, so an idempotent re-run never re-notifies. Best-effort.
      if (this.dispatch) {
        try {
          await this.dispatch.cycleOpened(submission);
          if (heads.length === 0) {
            await this.dispatch.clinicHasNoHeads(submission);
          }
        } catch (err) {
          this.logger.error(
            `cycle-open notification failed for ${submission.id}: ${(err as Error).message}`,
          );
        }
      }

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

  /**
   * Bring an UNTOUCHED cycle's heads in line with the clinic's current mapping.
   *
   * BR-05 freezes the head set at cycle-open so figures already entered never
   * shift under anyone. A cycle the SPOC has not entered anything into yet —
   * NOT_STARTED, or DRAFT with no entries (an empty save, or everything cleared) —
   * has nothing to protect, though; freezing it only strands the SPOC with a stale
   * (often empty) form when Finance maps heads after the month opened. So until
   * the first entry lands, the snapshot follows the mapping; from then on it is
   * frozen exactly as before.
   *
   * Only the difference is applied: heads unmapped since open are dropped, newly
   * mapped ones added, changed name/G/L no/multi-vendor refreshed. Unchanged
   * heads keep their snapshot ids, so a form already open in a browser stays
   * valid. Not audited: it records no user decision, only derives from the
   * mapping changes that are themselves audited.
   *
   * Returns false only when the caller's view is known to be current; true means
   * "reload" — this call changed the snapshot, or a concurrent resync/save did
   * while it waited for the lock.
   */
  async resyncUntouched(submissionId: string): Promise<boolean> {
    // Cheap unlocked pre-check so an up-to-date form costs no transaction.
    const sub = await this.prisma.monthlySubmission.findFirst({
      where: { id: submissionId, status: { in: [...RESYNC_STATUSES] }, entries: { none: {} } },
      select: { clinicId: true, snapshots: true },
    });
    if (!sub) return false;
    const heads = await this.clinicExpenseHeads.listMapped(sub.clinicId);
    if (isEmptyDiff(snapshotDiff(sub.snapshots, heads))) return false;

    return this.prisma.$transaction(async (tx) => {
      // Row lock shared with ProvisionEntryService.saveEntries: concurrent resyncs
      // run one after another (no insert deadlocks), and a first save either
      // commits before this point — so the re-check below sees its entries and
      // backs off — or waits until the snapshot change is done. The locking read
      // comes first so the reads after it see everything committed before it.
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM MonthlySubmission WHERE id = ${submissionId} FOR UPDATE`;
      // Past this point the caller's copy may be stale even if nothing is written
      // here (a concurrent resync or save got in first), so every exit returns true.
      if (!RESYNC_STATUSES.includes(locked[0]?.status as ResyncStatus)) return true;
      if ((await tx.provisionEntry.count({ where: { submissionId } })) > 0) return true;

      // Recompute under the lock: another resync may already have applied it.
      const current = await tx.submissionExpenseHeadSnapshot.findMany({ where: { submissionId } });
      const diff = snapshotDiff(current, heads);
      if (isEmptyDiff(diff)) return true;
      const { drop, add, refresh } = diff;
      const have = new Map(current.map((s) => [s.expenseHeadId, s]));

      if (drop.length > 0) {
        await tx.submissionExpenseHeadSnapshot.deleteMany({ where: { id: { in: drop } } });
      }
      if (add.length > 0) {
        await tx.submissionExpenseHeadSnapshot.createMany({
          data: add.map((h) => ({
            submissionId,
            expenseHeadId: h.expenseHeadId,
            expenseHeadGlNameAtSnapshot: h.glAccountName,
            expenseHeadGlNoAtSnapshot: h.glAccountNo,
            expenseHeadAllowsMultipleVendorsAtSnapshot: h.allowsMultipleVendors,
          })),
        });
      }
      for (const h of refresh) {
        await tx.submissionExpenseHeadSnapshot.update({
          where: { id: have.get(h.expenseHeadId)!.id },
          data: {
            expenseHeadGlNameAtSnapshot: h.glAccountName,
            expenseHeadGlNoAtSnapshot: h.glAccountNo,
            expenseHeadAllowsMultipleVendorsAtSnapshot: h.allowsMultipleVendors,
          },
        });
      }
      return true;
    });
  }

  private findOpened(clinicId: string, month: string): Promise<OpenedSubmission | null> {
    return this.prisma.monthlySubmission.findUnique({
      where: { clinicId_month: { clinicId, month } },
      include: { snapshots: true },
    });
  }
}

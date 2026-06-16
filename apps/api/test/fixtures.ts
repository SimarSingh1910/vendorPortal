import { HttpException } from '@nestjs/common';
import { SubmissionStatus, UserRole } from '@portal/shared';
import type { Clinic, ExpenseHead, User } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CycleService } from '../src/submissions/cycle.service';
import type { WorkflowService } from '../src/submissions/workflow.service';
import type { RequestUser } from '../src/auth/request-user';

/** Monotonic counter for unique names/emails across a whole run. */
let seq = 0;
const next = (): number => (seq += 1);

export interface FixtureCtx {
  prisma: PrismaService;
  cycle: CycleService;
  workflow: WorkflowService;
}

export interface TestUser {
  /** The RequestUser the services consume. */
  user: RequestUser;
  /** The persisted row (FKs in comments/entries reference this). */
  dbUser: User;
}

export function makeFixtures(ctx: FixtureCtx) {
  const { prisma, cycle, workflow } = ctx;

  async function makeClinic(opts: { active?: boolean; name?: string } = {}): Promise<Clinic> {
    const n = next();
    return prisma.clinic.create({
      data: {
        name: opts.name ?? `Clinic ${n}`,
        location: `Location ${n}`,
        corporateClient: `Client ${n}`,
        isActive: opts.active ?? true,
      },
    });
  }

  async function makeExpenseHead(
    opts: { name?: string; category?: string; active?: boolean } = {},
  ): Promise<ExpenseHead> {
    const n = next();
    return prisma.expenseHead.create({
      data: {
        name: opts.name ?? `Head ${n}`,
        category: opts.category ?? `Category ${n}`,
        isActive: opts.active ?? true,
      },
    });
  }

  /** Additively map heads to a clinic (active mapping rows). */
  async function mapHeads(clinicId: string, headIds: string[]): Promise<void> {
    for (const expenseHeadId of headIds) {
      await prisma.clinicExpenseHead.create({
        data: { clinicId, expenseHeadId, isActive: true },
      });
    }
  }

  async function makeUser(role: UserRole, clinicIds: string[] = []): Promise<TestUser> {
    const n = next();
    const dbUser = await prisma.user.create({
      data: {
        name: `User ${n}`,
        email: `user${n}@test.local`,
        passwordHash: 'x'.repeat(60),
        role,
        assignments: { create: clinicIds.map((clinicId) => ({ clinicId })) },
      },
    });
    const user: RequestUser = {
      id: dbUser.id,
      email: dbUser.email,
      role,
      clinicIds,
      tokenVersion: dbUser.tokenVersion,
    };
    return { user, dbUser };
  }

  /** Open a cycle through the real CycleService (exercises Step 5.1). */
  function openCycle(clinicId: string, month: string) {
    return cycle.openClinicCycle(clinicId, month);
  }

  /**
   * Insert a ProvisionEntry for every snapshot head of a submission (test stand-in
   * for the Step 6 data-entry surface). `leaveUnvalued` skips the last N heads (for
   * the BR-03 negative case); `amount` may be 0 (BR-07).
   */
  async function valueAllHeads(
    submissionId: string,
    opts: { amount?: number; leaveUnvalued?: number; enteredById?: string } = {},
  ): Promise<void> {
    const amount = opts.amount ?? 100;
    const leaveUnvalued = opts.leaveUnvalued ?? 0;

    let enteredById = opts.enteredById;
    if (!enteredById) {
      enteredById = (await makeUser(UserRole.CLINIC_SPOC)).user.id;
    }

    const snapshots = await prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      orderBy: { id: 'asc' },
    });
    const toValue =
      leaveUnvalued > 0 ? snapshots.slice(0, Math.max(0, snapshots.length - leaveUnvalued)) : snapshots;

    for (const snap of toValue) {
      await prisma.provisionEntry.create({
        data: {
          submissionId,
          snapshotId: snap.id,
          amount,
          enteredById,
          lastModifiedById: enteredById,
        },
      });
    }
  }

  /** Ordered forward path used by driveToStatus. */
  const DRIVE_ORDER: SubmissionStatus[] = [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.CLINIC_MANAGER_REVIEW,
    SubmissionStatus.CLINIC_APPROVED,
    SubmissionStatus.FINANCE_REVIEW,
    SubmissionStatus.FINANCE_APPROVED,
  ];

  /**
   * Advance a submission to `target` through the REAL WorkflowService, creating
   * appropriately-scoped actors. Returns the actors so a caller can keep acting.
   */
  async function driveToStatus(
    submissionId: string,
    target: SubmissionStatus,
  ): Promise<{ spoc: RequestUser; manager: RequestUser; finance: RequestUser }> {
    const submission = await prisma.monthlySubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    const clinicId = submission.clinicId;
    const spoc = (await makeUser(UserRole.CLINIC_SPOC, [clinicId])).user;
    const manager = (await makeUser(UserRole.CLINIC_MANAGER, [clinicId])).user;
    const finance = (await makeUser(UserRole.FINANCE_ADMIN)).user;

    if (target === SubmissionStatus.DRAFT) {
      await workflow.saveDraft(submissionId, spoc);
      return { spoc, manager, finance };
    }

    const stop = DRIVE_ORDER.indexOf(target);
    if (stop < 0) {
      throw new Error(`driveToStatus: unsupported target ${target}`);
    }

    // BR-03 must hold before SUBMIT.
    await valueAllHeads(submissionId, { enteredById: spoc.id });

    for (let i = 0; i <= stop; i += 1) {
      switch (DRIVE_ORDER[i]) {
        case SubmissionStatus.SUBMITTED:
          await workflow.submit(submissionId, spoc);
          break;
        case SubmissionStatus.CLINIC_MANAGER_REVIEW:
          await workflow.managerOpenReview(submissionId, manager);
          break;
        case SubmissionStatus.CLINIC_APPROVED:
          await workflow.managerApprove(submissionId, manager);
          break;
        case SubmissionStatus.FINANCE_REVIEW:
          await workflow.financeOpenReview(submissionId, finance);
          break;
        case SubmissionStatus.FINANCE_APPROVED:
          await workflow.financeApprove(submissionId, finance);
          break;
      }
    }
    return { spoc, manager, finance };
  }

  return {
    makeClinic,
    makeExpenseHead,
    mapHeads,
    makeUser,
    openCycle,
    valueAllHeads,
    driveToStatus,
  };
}

export type Fixtures = ReturnType<typeof makeFixtures>;

/**
 * Assert a promise rejects with a specific HTTP status (from a Nest
 * HttpException). Fails loudly if the call resolves instead.
 */
export async function expectStatus(p: Promise<unknown>, status: number): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(status);
    return;
  }
  throw new Error(`Expected rejection with HTTP ${status} but the call resolved`);
}

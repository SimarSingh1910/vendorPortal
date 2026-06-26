import { CorpDepartmentType, UserRole } from '@portal/shared';
import type { CorpBudgetCode, CorpDepartment, CorpExpenseHead } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CorpCycleService } from '../src/corp-submissions/corp-cycle.service';
import type { RequestUser } from '../src/auth/request-user';

/**
 * Test helpers for the corporate submission workflow (Phase C2). Mirrors
 * test/fixtures.ts (clinic) but for departments / corp heads / budget codes, and
 * corp users with department assignments. RequestUser carries no departmentIds
 * (corp scope is resolved from user_department_assignments), so makeUser only
 * needs to create the assignment rows.
 */
export function makeCorpFixtures(prisma: PrismaService, cycle: CorpCycleService) {
  let seq = 0;
  const n = (): number => (seq += 1);

  const makeDept = (
    opts: { active?: boolean; name?: string; type?: CorpDepartmentType } = {},
  ): Promise<CorpDepartment> =>
    prisma.corpDepartment.create({
      data: {
        name: opts.name ?? `Dept ${n()}`,
        isActive: opts.active ?? true,
        ...(opts.type ? { type: opts.type } : {}),
      },
    });

  const makeHead = (
    departmentId: string,
    opts: { name?: string; active?: boolean } = {},
  ): Promise<CorpExpenseHead> =>
    prisma.corpExpenseHead.create({
      data: { departmentId, name: opts.name ?? `Head ${n()}`, isActive: opts.active ?? true },
    });

  const makeBudgetCode = (
    departmentId: string,
    opts: { code?: string; active?: boolean } = {},
  ): Promise<CorpBudgetCode> =>
    prisma.corpBudgetCode.create({
      data: { departmentId, code: opts.code ?? `BR-C${n()}`, isActive: opts.active ?? true },
    });

  async function makeUser(role: UserRole, departmentIds: string[] = []): Promise<RequestUser> {
    const i = n();
    const dbUser = await prisma.user.create({
      data: {
        name: `U${i}`,
        email: `cu${i}@test.local`,
        passwordHash: 'x'.repeat(60),
        role,
        departmentAssignments: { create: departmentIds.map((departmentId) => ({ departmentId })) },
      },
    });
    return { id: dbUser.id, email: dbUser.email, role, clinicIds: [], tokenVersion: 0 };
  }

  const openCycle = (departmentId: string, month: string) =>
    cycle.openDepartmentCycle(departmentId, month);

  /**
   * Insert a complete CorpProvisionEntry (budget code + amount) for every snapshot
   * head of a submission — the submit-ready state. `leaveUnvalued` skips the last
   * N heads (for the BR-C16 negative case); `amount` may be 0 (BR-C16: 0 valid).
   */
  async function valueAllHeads(
    submissionId: string,
    budgetCodeId: string,
    enteredById: string,
    opts: { leaveUnvalued?: number; amount?: number } = {},
  ): Promise<void> {
    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      orderBy: { id: 'asc' },
    });
    const leave = opts.leaveUnvalued ?? 0;
    const toValue = leave > 0 ? snaps.slice(0, Math.max(0, snaps.length - leave)) : snaps;
    for (const s of toValue) {
      await prisma.corpProvisionEntry.create({
        data: {
          submissionId,
          snapshotId: s.id,
          budgetCodeId,
          amount: opts.amount ?? 100,
          enteredById,
          lastModifiedById: enteredById,
        },
      });
    }
  }

  return { makeDept, makeHead, makeBudgetCode, makeUser, openCycle, valueAllHeads };
}

export type CorpFixtures = ReturnType<typeof makeCorpFixtures>;

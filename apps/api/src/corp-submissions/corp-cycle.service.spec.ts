import { Test, type TestingModule } from '@nestjs/testing';
import type { CorpDepartment, CorpExpenseHead } from '@prisma/client';
import { CorpSubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from './corp-cycle.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

const MONTH = '2026-07';

/**
 * Step C2.1 — corporate cycle opening + head snapshot. Opening a department/month
 * is idempotent and freezes the department's ACTIVE expense heads onto the
 * submission (BR-C11); later master changes never alter an already-open cycle.
 */
describe('CorpCycleService (Step C2.1 — corporate cycle opening + snapshot)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CorpCycleService;
  let seq = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, CorpExpenseHeadsService, CorpCycleService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CorpCycleService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const makeDept = (opts: { active?: boolean; name?: string } = {}): Promise<CorpDepartment> => {
    seq += 1;
    return prisma.corpDepartment.create({
      data: { name: opts.name ?? `Dept ${seq}`, isActive: opts.active ?? true },
    });
  };

  const makeHead = (
    departmentId: string,
    opts: { name?: string; active?: boolean } = {},
  ): Promise<CorpExpenseHead> => {
    seq += 1;
    return prisma.corpExpenseHead.create({
      data: { departmentId, name: opts.name ?? `Head ${seq}`, isActive: opts.active ?? true },
    });
  };

  it('opens an active department with 3 active heads → 1 NOT_STARTED submission + 3 matching snapshots', async () => {
    const dept = await makeDept();
    const heads = [
      await makeHead(dept.id, { name: 'Salaries' }),
      await makeHead(dept.id, { name: 'Travel' }),
      await makeHead(dept.id, { name: 'Software' }),
    ];

    const { submission, created } = await cycle.openDepartmentCycle(dept.id, MONTH);

    expect(created).toBe(true);
    expect(submission.status).toBe(CorpSubmissionStatus.NOT_STARTED);
    expect(await prisma.corpMonthlySubmission.count({ where: { departmentId: dept.id } })).toBe(1);

    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    expect(snaps).toHaveLength(3);

    const byHead = new Map(snaps.map((s) => [s.expenseHeadId, s]));
    for (const head of heads) {
      const snap = byHead.get(head.id);
      expect(snap).toBeDefined();
      expect(snap!.expenseHeadNameAtSnapshot).toBe(head.name);
    }
  });

  it('snapshots ONLY active heads (inactive heads are excluded)', async () => {
    const dept = await makeDept();
    await makeHead(dept.id, { name: 'Active head', active: true });
    await makeHead(dept.id, { name: 'Retired head', active: false });

    const { submission } = await cycle.openDepartmentCycle(dept.id, MONTH);

    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    expect(snaps.map((s) => s.expenseHeadNameAtSnapshot)).toEqual(['Active head']);
  });

  it('opens a department with 0 active heads → submission with an empty snapshot', async () => {
    const dept = await makeDept();

    const { submission, created } = await cycle.openDepartmentCycle(dept.id, MONTH);

    expect(created).toBe(true);
    expect(
      await prisma.corpSubmissionExpenseHeadSnapshot.count({ where: { submissionId: submission.id } }),
    ).toBe(0);
  });

  it('freezes the snapshot: deactivating/renaming a head afterward leaves it unchanged (BR-C11)', async () => {
    const dept = await makeDept();
    const toDeactivate = await makeHead(dept.id, { name: 'Utilities' });
    const toRename = await makeHead(dept.id, { name: 'Marketing' });

    const { submission } = await cycle.openDepartmentCycle(dept.id, MONTH);

    // Mutate the live masters AFTER the cycle opened.
    await prisma.corpExpenseHead.update({ where: { id: toDeactivate.id }, data: { isActive: false } });
    await prisma.corpExpenseHead.update({ where: { id: toRename.id }, data: { name: 'Brand & Marketing' } });

    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    expect(snaps).toHaveLength(2);
    expect(snaps.map((s) => s.expenseHeadNameAtSnapshot).sort()).toEqual(['Marketing', 'Utilities']);
    const renamed = snaps.find((s) => s.expenseHeadId === toRename.id)!;
    expect(renamed.expenseHeadNameAtSnapshot).toBe('Marketing');
  });

  it('is idempotent: re-opening the same department/month returns the same submission, no dup snapshots', async () => {
    const dept = await makeDept();
    await makeHead(dept.id);

    const first = await cycle.openDepartmentCycle(dept.id, MONTH);
    const second = await cycle.openDepartmentCycle(dept.id, MONTH);

    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);
    expect(await prisma.corpMonthlySubmission.count({ where: { departmentId: dept.id } })).toBe(1);
    expect(
      await prisma.corpSubmissionExpenseHeadSnapshot.count({ where: { submissionId: first.submission.id } }),
    ).toBe(1);
  });

  it('a re-open never re-snapshots even if active heads changed since opening', async () => {
    const dept = await makeDept();
    await makeHead(dept.id, { name: 'Original' });

    const first = await cycle.openDepartmentCycle(dept.id, MONTH);
    // Add a new active head AFTER opening; a re-open must not pick it up.
    await makeHead(dept.id, { name: 'Added later' });

    const second = await cycle.openDepartmentCycle(dept.id, MONTH);
    expect(second.created).toBe(false);
    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: first.submission.id },
    });
    expect(snaps.map((s) => s.expenseHeadNameAtSnapshot)).toEqual(['Original']);
  });

  it('openMonth is idempotent across active departments (second run creates 0; inactive skipped)', async () => {
    const deptA = await makeDept();
    const deptB = await makeDept();
    await makeDept({ active: false }); // inactive departments are skipped

    const run1 = await cycle.openMonth(MONTH);
    expect(run1.activeDepartments).toBe(2);
    expect(run1.created).toBe(2);
    expect(run1.alreadyOpen).toBe(0);

    const run2 = await cycle.openMonth(MONTH);
    expect(run2.activeDepartments).toBe(2);
    expect(run2.created).toBe(0);
    expect(run2.alreadyOpen).toBe(2);

    expect(await prisma.corpMonthlySubmission.count()).toBe(2);
    expect(await prisma.corpMonthlySubmission.count({ where: { departmentId: deptA.id } })).toBe(1);
    expect(await prisma.corpMonthlySubmission.count({ where: { departmentId: deptB.id } })).toBe(1);
  });

  it('rejects a bad month (400), a non-existent department (404), and a NEW cycle for an inactive department (400)', async () => {
    await expectStatus(cycle.openDepartmentCycle('whatever', '2026-13'), 400);
    await expectStatus(cycle.openDepartmentCycle('does-not-exist', MONTH), 404);

    const inactive = await makeDept({ active: false });
    await expectStatus(cycle.openDepartmentCycle(inactive.id, MONTH), 400);
  });

  it('records one CORP_CYCLE_OPEN audit row per created cycle (idempotent re-open adds none)', async () => {
    const dept = await makeDept();
    await makeHead(dept.id);

    const { submission } = await cycle.openDepartmentCycle(dept.id, MONTH);
    await cycle.openDepartmentCycle(dept.id, MONTH); // idempotent, no new audit row

    const rows = await prisma.auditLog.findMany({
      where: { action: 'CORP_CYCLE_OPEN', entityType: 'CorpMonthlySubmission', entityId: submission.id },
    });
    expect(rows).toHaveLength(1);
  });
});

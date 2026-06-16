import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { AuditService } from '../audit/audit.service';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

describe('CycleService (Step 5.1 — cycle opening + snapshot)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('opens an active clinic with 3 mapped heads → 1 NOT_STARTED submission + 3 matching snapshots', async () => {
    const clinic = await fx.makeClinic();
    const heads = [
      await fx.makeExpenseHead({ name: 'Salaries', category: 'Payroll' }),
      await fx.makeExpenseHead({ name: 'Rent', category: 'Facilities' }),
      await fx.makeExpenseHead({ name: 'Consumables', category: 'Supplies' }),
    ];
    await fx.mapHeads(clinic.id, heads.map((h) => h.id));

    const { submission, created } = await cycle.openClinicCycle(clinic.id, MONTH);

    expect(created).toBe(true);
    expect(submission.status).toBe(SubmissionStatus.NOT_STARTED);

    const submissionCount = await prisma.monthlySubmission.count({ where: { clinicId: clinic.id } });
    expect(submissionCount).toBe(1);

    const snaps = await prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    expect(snaps).toHaveLength(3);

    const byHead = new Map(snaps.map((s) => [s.expenseHeadId, s]));
    for (const head of heads) {
      const snap = byHead.get(head.id);
      expect(snap).toBeDefined();
      expect(snap!.expenseHeadNameAtSnapshot).toBe(head.name);
      expect(snap!.expenseHeadCategoryAtSnapshot).toBe(head.category);
    }
  });

  it('opens a clinic with 0 mappings → submission with an empty snapshot', async () => {
    const clinic = await fx.makeClinic();

    const { submission, created } = await cycle.openClinicCycle(clinic.id, MONTH);

    expect(created).toBe(true);
    const snaps = await prisma.submissionExpenseHeadSnapshot.count({
      where: { submissionId: submission.id },
    });
    expect(snaps).toBe(0);
  });

  it('freezes the snapshot: deactivating/renaming a head afterward leaves it unchanged', async () => {
    const clinic = await fx.makeClinic();
    const toDeactivate = await fx.makeExpenseHead({ name: 'Utilities', category: 'Facilities' });
    const toRename = await fx.makeExpenseHead({ name: 'Marketing', category: 'Growth' });
    await fx.mapHeads(clinic.id, [toDeactivate.id, toRename.id]);

    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);

    // Mutate the live masters AFTER the cycle opened.
    await prisma.expenseHead.update({ where: { id: toDeactivate.id }, data: { isActive: false } });
    await prisma.expenseHead.update({
      where: { id: toRename.id },
      data: { name: 'Brand & Marketing', category: 'Demand Gen' },
    });

    const snaps = await prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
      orderBy: { expenseHeadNameAtSnapshot: 'asc' },
    });

    expect(snaps).toHaveLength(2);
    const names = snaps.map((s) => s.expenseHeadNameAtSnapshot).sort();
    expect(names).toEqual(['Marketing', 'Utilities']);
    const renamedSnap = snaps.find((s) => s.expenseHeadId === toRename.id)!;
    expect(renamedSnap.expenseHeadNameAtSnapshot).toBe('Marketing');
    expect(renamedSnap.expenseHeadCategoryAtSnapshot).toBe('Growth');
  });

  it('is idempotent: re-opening the same clinic/month returns the same submission, no dup snapshots', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);

    const first = await cycle.openClinicCycle(clinic.id, MONTH);
    const second = await cycle.openClinicCycle(clinic.id, MONTH);

    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);

    expect(await prisma.monthlySubmission.count({ where: { clinicId: clinic.id } })).toBe(1);
    expect(
      await prisma.submissionExpenseHeadSnapshot.count({ where: { submissionId: first.submission.id } }),
    ).toBe(1);
  });

  it('openMonth is idempotent across active clinics (second run creates 0)', async () => {
    const clinicA = await fx.makeClinic();
    const clinicB = await fx.makeClinic();
    await fx.makeClinic({ active: false }); // inactive clinics are skipped

    const run1 = await cycle.openMonth(MONTH);
    expect(run1.activeClinics).toBe(2);
    expect(run1.created).toBe(2);
    expect(run1.alreadyOpen).toBe(0);

    const run2 = await cycle.openMonth(MONTH);
    expect(run2.activeClinics).toBe(2);
    expect(run2.created).toBe(0);
    expect(run2.alreadyOpen).toBe(2);

    // Exactly one submission per active clinic, none for the inactive one.
    expect(await prisma.monthlySubmission.count()).toBe(2);
    expect(await prisma.monthlySubmission.count({ where: { clinicId: clinicA.id } })).toBe(1);
    expect(await prisma.monthlySubmission.count({ where: { clinicId: clinicB.id } })).toBe(1);
  });

  it('rejects opening a non-existent clinic (404) and a NEW cycle for an inactive clinic (400)', async () => {
    await expectStatus(cycle.openClinicCycle('does-not-exist', MONTH), 404);

    const inactive = await fx.makeClinic({ active: false });
    await expectStatus(cycle.openClinicCycle(inactive.id, MONTH), 400);
  });
});

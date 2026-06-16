import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { DashboardService } from './dashboard.service';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';
import type { RequestUser } from '../auth/request-user';

/**
 * Phase 11 (FR-07) analytics: aggregated totals, the BR-12 variance threshold,
 * and clinic scoping (finance sees all; clinic roles see only their clinics).
 */
describe('DashboardService (Phase 11, FR-07)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let dashboard: DashboardService;
  let fx: Fixtures;
  let finance: RequestUser;
  let spocId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        AuditService,
        CycleService,
        WorkflowService,
        DashboardService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    dashboard = moduleRef.get(DashboardService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    spocId = (await fx.makeUser(UserRole.CLINIC_SPOC)).user.id;
  });

  /** Open a clinic's cycle and set one head's amount for that month. */
  async function enter(clinicId: string, month: string, expenseHeadId: string, amount: number) {
    const { submission } = await cycle.openClinicCycle(clinicId, month);
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId },
    });
    await prisma.provisionEntry.create({
      data: { submissionId: submission.id, snapshotId: snap.id, amount, enteredById: spocId, lastModifiedById: spocId },
    });
    return submission.id;
  }

  it('status tracker lists active clinics with their month total; inactive excluded', async () => {
    const a = await fx.makeClinic({ name: 'Alpha' });
    const b = await fx.makeClinic({ name: 'Bravo' });
    await fx.makeClinic({ name: 'Zinactive', active: false });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(a.id, [head.id]);
    await fx.mapHeads(b.id, [head.id]);
    await enter(a.id, '2026-06', head.id, 500);
    // Bravo's cycle is open but unvalued.
    await cycle.openClinicCycle(b.id, '2026-06');

    const tiles = await dashboard.statusTracker(finance, '2026-06');

    expect(tiles.map((t) => t.clinicName)).toEqual(['Alpha', 'Bravo']); // no inactive
    const alpha = tiles.find((t) => t.clinicName === 'Alpha')!;
    expect(alpha.total).toBe('500.00');
    expect(alpha.status).toBe(SubmissionStatus.NOT_STARTED);
    const bravo = tiles.find((t) => t.clinicName === 'Bravo')!;
    expect(bravo.total).toBeNull(); // open but nothing entered
  });

  it('monthly totals sum per month across clinics', async () => {
    const a = await fx.makeClinic();
    const b = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(a.id, [head.id]);
    await fx.mapHeads(b.id, [head.id]);
    await enter(a.id, '2026-05', head.id, 100);
    await enter(b.id, '2026-05', head.id, 200);
    await enter(a.id, '2026-06', head.id, 400);

    const points = await dashboard.monthlyTotals(finance, { from: '2026-05', to: '2026-06' });

    expect(points).toEqual([
      { month: '2026-05', total: '300.00' },
      { month: '2026-06', total: '400.00' },
    ]);
  });

  it('clinic totals aggregate over the range, ordered by spend desc', async () => {
    const a = await fx.makeClinic({ name: 'Small' });
    const b = await fx.makeClinic({ name: 'Big' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(a.id, [head.id]);
    await fx.mapHeads(b.id, [head.id]);
    await enter(a.id, '2026-06', head.id, 100);
    await enter(b.id, '2026-06', head.id, 900);

    const totals = await dashboard.clinicTotals(finance, { from: '2026-06', to: '2026-06' });

    expect(totals.map((t) => [t.clinicName, t.total])).toEqual([
      ['Big', '900.00'],
      ['Small', '100.00'],
    ]);
  });

  it('variance flags a head only when deviation exceeds the configured threshold', async () => {
    const clinic = await fx.makeClinic();
    const spiker = await fx.makeExpenseHead({ name: 'Spiker' });
    const steady = await fx.makeExpenseHead({ name: 'Steady' });
    await fx.mapHeads(clinic.id, [spiker.id, steady.id]);

    // Prior month: both 100.
    await cycle.openClinicCycle(clinic.id, '2026-05');
    await enterHead(clinic.id, '2026-05', spiker.id, 100);
    await enterHead(clinic.id, '2026-05', steady.id, 100);
    // Current month: Spiker +50% (>10), Steady +5% (<10).
    await cycle.openClinicCycle(clinic.id, '2026-06');
    await enterHead(clinic.id, '2026-06', spiker.id, 150);
    await enterHead(clinic.id, '2026-06', steady.id, 105);

    await prisma.notificationConfig.create({
      data: {
        month: '2026-06',
        monthStartNotifyDate: new Date('2026-06-01T00:00:00Z'),
        cutoffDate: new Date('2026-06-20T00:00:00Z'),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });

    const report = await dashboard.variance(finance, '2026-06');

    expect(report.priorMonth).toBe('2026-05');
    expect(report.thresholdPercent).toBe('10.00');
    const spike = report.rows.find((r) => r.expenseHeadName === 'Spiker')!;
    const calm = report.rows.find((r) => r.expenseHeadName === 'Steady')!;
    expect(spike.deviationPercent).toBe('50.00');
    expect(spike.flagged).toBe(true);
    expect(calm.deviationPercent).toBe('5.00');
    expect(calm.flagged).toBe(false);
    // Flagged rows sort first.
    expect(report.rows[0].expenseHeadName).toBe('Spiker');
  });

  it('scopes results to a clinic role’s assigned clinics', async () => {
    const mine = await fx.makeClinic({ name: 'Mine' });
    const other = await fx.makeClinic({ name: 'Other' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(mine.id, [head.id]);
    await fx.mapHeads(other.id, [head.id]);
    await enter(mine.id, '2026-06', head.id, 100);
    await enter(other.id, '2026-06', head.id, 999);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [mine.id])).user;

    const tiles = await dashboard.statusTracker(spoc, '2026-06');
    expect(tiles.map((t) => t.clinicName)).toEqual(['Mine']);

    const totals = await dashboard.clinicTotals(spoc, { from: '2026-06', to: '2026-06' });
    expect(totals.map((t) => t.clinicName)).toEqual(['Mine']);
    expect(totals[0].total).toBe('100.00');
  });

  it('applies the status filter to aggregations', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', head.id, 100); // submission stays NOT_STARTED

    const matching = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      status: [SubmissionStatus.NOT_STARTED],
    });
    expect(matching).toEqual([{ month: '2026-06', total: '100.00' }]);

    const nonMatching = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      status: [SubmissionStatus.FINANCE_APPROVED],
    });
    expect(nonMatching).toEqual([]);
  });

  /** Set a specific head's amount for an already-open cycle month. */
  async function enterHead(clinicId: string, month: string, expenseHeadId: string, amount: number) {
    const sub = await prisma.monthlySubmission.findUniqueOrThrow({
      where: { clinicId_month: { clinicId, month } },
    });
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: sub.id, expenseHeadId },
    });
    await prisma.provisionEntry.create({
      data: { submissionId: sub.id, snapshotId: snap.id, amount, enteredById: spocId, lastModifiedById: spocId },
    });
  }
});

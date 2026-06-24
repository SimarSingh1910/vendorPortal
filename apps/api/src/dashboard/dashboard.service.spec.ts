import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
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

  it('variance returns fiscal-year-to-date AVERAGE per head: FY total ÷ elapsed FY months, missing months as 0', async () => {
    const clinic = await fx.makeClinic();
    const rent = await fx.makeExpenseHead({ name: 'Rent' });
    const adhoc = await fx.makeExpenseHead({ name: 'Adhoc' });
    await fx.mapHeads(clinic.id, [rent.id, adhoc.id]);

    // FY 2026-27 starts 2026-04. As of June, 3 FY months have elapsed (Apr–Jun).
    // Rent valued every month; Adhoc skips May (→ 0 in both sum and that month).
    await cycle.openClinicCycle(clinic.id, '2026-04');
    await enterHead(clinic.id, '2026-04', rent.id, 1000);
    await enterHead(clinic.id, '2026-04', adhoc.id, 500);
    await cycle.openClinicCycle(clinic.id, '2026-05');
    await enterHead(clinic.id, '2026-05', rent.id, 2000);
    await cycle.openClinicCycle(clinic.id, '2026-06');
    await enterHead(clinic.id, '2026-06', rent.id, 3000);
    await enterHead(clinic.id, '2026-06', adhoc.id, 1500);

    const report = await dashboard.variance(finance, '2026-06');
    const rentRow = report.rows.find((r) => r.expenseHeadName === 'Rent')!;
    const adhocRow = report.rows.find((r) => r.expenseHeadName === 'Adhoc')!;

    // Average over the 3 elapsed FY months (missing months counted as 0).
    expect(rentRow.ytdAverage).toBe('2000.00'); // (1000 + 2000 + 3000) / 3
    expect(adhocRow.ytdAverage).toBe('666.67'); // (500 + 0 + 1500) / 3, rounded

    // Prior / Current / Deviation unchanged by the YTD-average addition.
    expect(rentRow.prior).toBe('2000.00'); // May
    expect(rentRow.current).toBe('3000.00'); // Jun
    expect(rentRow.deviationPercent).toBe('50.00');
  });

  it('YTD average in April equals the current month only — the prior fiscal year is excluded', async () => {
    const clinic = await fx.makeClinic();
    const rent = await fx.makeExpenseHead({ name: 'Rent' });
    await fx.mapHeads(clinic.id, [rent.id]);

    // March 2026 belongs to the PREVIOUS fiscal year; April 2026 starts the new one.
    await cycle.openClinicCycle(clinic.id, '2026-03');
    await enterHead(clinic.id, '2026-03', rent.id, 9999);
    await cycle.openClinicCycle(clinic.id, '2026-04');
    await enterHead(clinic.id, '2026-04', rent.id, 700);

    const report = await dashboard.variance(finance, '2026-04');
    const rentRow = report.rows.find((r) => r.expenseHeadName === 'Rent')!;

    expect(report.priorMonth).toBe('2026-03');
    expect(rentRow.current).toBe('700.00');
    // March (prior FY) is excluded; only 1 FY month has elapsed, so the average
    // equals the current month.
    expect(rentRow.ytdAverage).toBe('700.00');
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

  // ── Step 4 — month-wise clinic report ───────────────────────────────────────

  it('month-wise report: window = current + N preceding (chronological, current last) with gaps as null', async () => {
    const clinic = await fx.makeClinic({ name: 'Reportee' });
    const head = await fx.makeExpenseHead({ name: 'Rent' });
    await fx.mapHeads(clinic.id, [head.id]);
    // Data in Apr/May/Jun; March is a gap. Current cycle month pinned to 2026-06.
    await enter(clinic.id, '2026-04', head.id, 400);
    await enter(clinic.id, '2026-05', head.id, 500);
    await enter(clinic.id, '2026-06', head.id, 600);

    const r3 = await dashboard.clinicMonthwise(finance, clinic.id, 3, '2026-06');
    expect(r3.currentMonth).toBe('2026-06');
    expect(r3.months).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(r3.rows).toHaveLength(1);
    expect(r3.rows[0]).toMatchObject({ expenseHeadName: 'Rent' });
    expect(r3.rows[0].values).toEqual([null, '400.00', '500.00', '600.00']); // March gap → null
    expect(r3.totals).toEqual([null, '400.00', '500.00', '600.00']);

    // "Last 1" preset → just the prior month + current.
    const r1 = await dashboard.clinicMonthwise(finance, clinic.id, 1, '2026-06');
    expect(r1.months).toEqual(['2026-05', '2026-06']);
    expect(r1.rows[0].values).toEqual(['500.00', '600.00']);
  });

  it('month-wise report: current month with no data still appears as a (blank) column', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-05', head.id, 500); // only the prior month has data

    const r = await dashboard.clinicMonthwise(finance, clinic.id, 1, '2026-06');
    expect(r.months).toEqual(['2026-05', '2026-06']);
    expect(r.rows[0].values).toEqual(['500.00', null]); // current month blank, no error
    expect(r.totals).toEqual(['500.00', null]);
  });

  it('month-wise report: clinic role gets its own clinic but is rejected (403) for another', async () => {
    const mine = await fx.makeClinic({ name: 'Mine' });
    const other = await fx.makeClinic({ name: 'Other' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(mine.id, [head.id]);
    await fx.mapHeads(other.id, [head.id]);
    await enter(mine.id, '2026-06', head.id, 100);
    await enter(other.id, '2026-06', head.id, 999);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [mine.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [mine.id])).user;

    const own = await dashboard.clinicMonthwise(spoc, mine.id, 1, '2026-06');
    expect(own.clinicName).toBe('Mine');
    expect(own.rows[0].values.at(-1)).toBe('100.00');

    // Either clinic role requesting a clinic outside their scope → 403.
    await expectStatus(dashboard.clinicMonthwise(spoc, other.id, 1, '2026-06'), 403);
    await expectStatus(dashboard.clinicMonthwise(manager, other.id, 1, '2026-06'), 403);

    // Finance sees any clinic.
    const fin = await dashboard.clinicMonthwise(finance, other.id, 1, '2026-06');
    expect(fin.rows[0].values.at(-1)).toBe('999.00');
  });

  it('month-wise report is a READ — writes no audit row', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', head.id, 100);

    const before = await prisma.auditLog.count();
    await dashboard.clinicMonthwise(finance, clinic.id, 3, '2026-06');
    expect(await prisma.auditLog.count()).toBe(before);
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

describe('clinic-monthwise endpoint authorization (Step 4)', () => {
  const guard = new RolesGuard(new Reflector());
  const ctx = (role: UserRole): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => DashboardController.prototype.clinicMonthwise,
      getClass: () => DashboardController,
    }) as unknown as ExecutionContext;

  it('allows the edit/review roles (SPOC, Clinic Manager, Finance Admin, Finance Manager)', () => {
    for (const r of [
      UserRole.CLINIC_SPOC,
      UserRole.CLINIC_MANAGER,
      UserRole.FINANCE_ADMIN,
      UserRole.FINANCE_MANAGER,
    ]) {
      expect(guard.canActivate(ctx(r))).toBe(true);
    }
  });

  it('excludes CLINIC_VIEWER (403)', () => {
    expect(() => guard.canActivate(ctx(UserRole.CLINIC_VIEWER))).toThrow(ForbiddenException);
  });
});

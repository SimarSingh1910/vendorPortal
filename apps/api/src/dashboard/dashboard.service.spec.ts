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
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';

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
        AttachmentsService,
        CorpDepartmentScopeService,
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

  it('per-head/clinic totals SUM every vendor line of a multi-vendor head (not one per head)', async () => {
    const a = await fx.makeClinic({ name: 'Multi' });
    const head = await fx.makeExpenseHead({ allowsMultipleVendors: true });
    await fx.mapHeads(a.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(a.id, '2026-06');
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId: head.id },
    });
    // Two vendor lines on the one head: 100 + 250.
    await prisma.provisionEntry.createMany({
      data: [
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 0, amount: 100, enteredById: spocId, lastModifiedById: spocId },
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 1, amount: 250, enteredById: spocId, lastModifiedById: spocId },
      ],
    });

    const tiles = await dashboard.statusTracker(finance, '2026-06');
    // The head is not split into two series/rows — its total is the SUM of both lines.
    expect(tiles.find((t) => t.clinicName === 'Multi')!.total).toBe('350.00');

    const clinicTotals = await dashboard.clinicTotals(finance, { from: '2026-06', to: '2026-06' });
    expect(clinicTotals.find((c) => c.clinicName === 'Multi')!.total).toBe('350.00');
  });

  it('per-head totals equal the summed particular values, with no fan-out across particulars', async () => {
    const clinic = await fx.makeClinic({ name: 'Particulars' });
    const head = await fx.makeExpenseHead({ glAccountName: 'Consumables', allowsMultipleVendors: true });
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-06');
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId: head.id },
    });

    // One head, two vendor lines, and a DIFFERENT number of particulars on each —
    // so a query that joined particulars would fan out asymmetrically and the
    // wrong total would be obvious rather than coincidentally right.
    const line = async (lineOrder: number, rows: Array<[string, number, number]>) => {
      const values = rows.map(([, rate, qty]) => Math.round(rate * qty * 100));
      await prisma.provisionEntry.create({
        data: {
          submissionId: submission.id,
          snapshotId: snap.id,
          lineOrder,
          amount: (values.reduce((a, b) => a + b, 0) / 100).toFixed(2),
          enteredById: spocId,
          lastModifiedById: spocId,
          particulars: {
            create: rows.map(([name, rate, quantity], i) => ({
              lineOrder: i,
              particularName: name,
              rate: String(rate),
              quantity: String(quantity),
              value: (values[i] / 100).toFixed(2),
            })),
          },
        },
      });
    };
    await line(0, [
      ['Gloves', 400, 30], // 12,000.00
      ['Masks', 15, 300], //  4,500.00
      ['Swabs', 2.5, 200], //    500.00
    ]);
    await line(1, [['Syringes', 9, 1000]]); // 9,000.00

    // Ground truth: the sum of every stored particular value.
    const stored = await prisma.entryParticular.findMany({ where: { entry: { snapshotId: snap.id } } });
    expect(stored).toHaveLength(4);
    const expected = stored.reduce((s, p) => s + Number(p.value), 0);
    expect(expected).toBe(26000);

    // The head appears ONCE (not once per vendor line, not once per particular),
    // and its total is the derived sum — not multiplied by any join cardinality.
    const trends = await dashboard.headTrends(finance, { from: '2026-06', to: '2026-06' });
    const forHead = trends.filter((t) => t.expenseHeadId === head.id);
    expect(forHead).toHaveLength(1);
    expect(Number(forHead[0].total)).toBe(expected);

    // Same figure through the clinic and status-tile aggregations.
    const clinicTotals = await dashboard.clinicTotals(finance, { from: '2026-06', to: '2026-06' });
    expect(Number(clinicTotals.find((c) => c.clinicName === 'Particulars')!.total)).toBe(expected);
    const tiles = await dashboard.statusTracker(finance, '2026-06');
    expect(Number(tiles.find((t) => t.clinicName === 'Particulars')!.total)).toBe(expected);
    const monthly = await dashboard.monthlyTotals(finance, { from: '2026-06', to: '2026-06' });
    expect(Number(monthly.find((m) => m.month === '2026-06')!.total)).toBe(expected);
  });

  it('head-vendor breakdown splits a head by vendor (null bucket separate), reconciling with the head total', async () => {
    const a = await fx.makeClinic({ name: 'VendorBreak' });
    const head = await fx.makeExpenseHead({ allowsMultipleVendors: true });
    await fx.mapHeads(a.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(a.id, '2026-06');
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId: head.id },
    });
    await prisma.provisionEntry.createMany({
      data: [
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 0, amount: 100, vendorName: 'Quess Corp', enteredById: spocId, lastModifiedById: spocId },
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 1, amount: 250, vendorName: 'Sodexo', enteredById: spocId, lastModifiedById: spocId },
        // A line with no vendor → its own null bucket ("—").
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 2, amount: 50, vendorName: null, enteredById: spocId, lastModifiedById: spocId },
        // A blank (null-amount) line is excluded entirely (NULL ≠ 0).
        { submissionId: submission.id, snapshotId: snap.id, lineOrder: 3, amount: null, vendorName: 'Ghost', enteredById: spocId, lastModifiedById: spocId },
      ],
    });

    const vendor = await dashboard.headVendorTrends(finance, { from: '2026-06', to: '2026-06' });
    // Three vendor buckets (Quess, Sodexo, null) — the blank-amount "Ghost" line is gone.
    expect(vendor).toHaveLength(3);
    const byVendor = new Map(vendor.map((v) => [v.vendorName, v.total]));
    expect(byVendor.get('Quess Corp')).toBe('100.00');
    expect(byVendor.get('Sodexo')).toBe('250.00');
    expect(byVendor.get(null)).toBe('50.00');
    expect(vendor.every((v) => v.expenseHeadId === head.id)).toBe(true);

    // Vendor rows reconcile exactly with the head-level total (400).
    const heads = await dashboard.headTrends(finance, { from: '2026-06', to: '2026-06' });
    const headTotal = Number(heads.find((h) => h.expenseHeadId === head.id)!.total);
    const vendorSum = vendor.reduce((s, v) => s + Number(v.total), 0);
    expect(vendorSum).toBe(headTotal);
    expect(headTotal).toBe(400);
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
    const spiker = await fx.makeExpenseHead({ glAccountName:'Spiker' });
    const steady = await fx.makeExpenseHead({ glAccountName:'Steady' });
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
    const rent = await fx.makeExpenseHead({ glAccountName:'Rent' });
    const adhoc = await fx.makeExpenseHead({ glAccountName:'Adhoc' });
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
    const rent = await fx.makeExpenseHead({ glAccountName:'Rent' });
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

  // ── Clinic SPOC: names on tiles + the SPOC filter ───────────────────────────

  /** Two clinics with named SPOCs, plus a third with none. */
  async function clinicsWithSpocs() {
    const alpha = await fx.makeClinic({ name: 'Alpha' });
    const bravo = await fx.makeClinic({ name: 'Bravo' });
    const orphan = await fx.makeClinic({ name: 'Orphan' });
    const head = await fx.makeExpenseHead();
    for (const c of [alpha, bravo, orphan]) await fx.mapHeads(c.id, [head.id]);
    await enter(alpha.id, '2026-06', head.id, 100);
    await enter(bravo.id, '2026-06', head.id, 200);
    await enter(orphan.id, '2026-06', head.id, 300);

    const asha = (await fx.makeUser(UserRole.CLINIC_SPOC, [alpha.id], { name: 'Asha Rao' })).user;
    const bhavin = (await fx.makeUser(UserRole.CLINIC_SPOC, [bravo.id], { name: 'Bhavin Shah' }))
      .user;
    return { alpha, bravo, orphan, head, asha, bhavin };
  }

  it('shows the clinic SPOC name on each tile for finance roles, and “none” when unassigned', async () => {
    await clinicsWithSpocs();

    for (const role of [UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER]) {
      const viewer = (await fx.makeUser(role)).user;
      const tiles = await dashboard.statusTracker(viewer, '2026-06');
      const byName = new Map(tiles.map((t) => [t.clinicName, t]));
      expect(byName.get('Alpha')!.spocNames).toEqual(['Asha Rao']);
      expect(byName.get('Bravo')!.spocNames).toEqual(['Bhavin Shah']);
      // A clinic with no SPOC reports an EMPTY list, not null — "nobody assigned"
      // is a real signal for finance, distinct from "not shown to you".
      expect(byName.get('Orphan')!.spocNames).toEqual([]);
    }
  });

  it('lists every active SPOC of a clinic, and omits deactivated ones', async () => {
    const clinic = await fx.makeClinic({ name: 'Shared' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', head.id, 100);

    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id], { name: 'Zara Khan' });
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id], { name: 'Amit Verma' });
    // Deactivated: cannot act on a submission, so naming them as the contact
    // would be misleading.
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id], { name: 'Gone Away', active: false });
    // A clinic MANAGER on the same clinic is not a SPOC and must not appear.
    await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id], { name: 'The Manager' });

    const tiles = await dashboard.statusTracker(finance, '2026-06');
    expect(tiles.find((t) => t.clinicName === 'Shared')!.spocNames).toEqual([
      'Amit Verma',
      'Zara Khan',
    ]);
  });

  it('hides SPOC names from clinic-scoped viewers (null, not an empty list)', async () => {
    const { alpha } = await clinicsWithSpocs();
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [alpha.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [alpha.id])).user;

    for (const viewer of [spoc, manager]) {
      const tiles = await dashboard.statusTracker(viewer, '2026-06');
      expect(tiles).toHaveLength(1);
      // null ≠ [] — the tile hides the line rather than claiming "no SPOC".
      expect(tiles[0].spocNames).toBeNull();
    }
  });

  it('the SPOC filter narrows every aggregation to that SPOC’s clinics', async () => {
    const { asha } = await clinicsWithSpocs();

    const tiles = await dashboard.statusTracker(finance, '2026-06', [asha.id]);
    expect(tiles.map((t) => t.clinicName)).toEqual(['Alpha']);

    const totals = await dashboard.clinicTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      spocUserId: asha.id,
    });
    expect(totals.map((t) => t.clinicName)).toEqual(['Alpha']);
    expect(totals[0].total).toBe('100.00');

    // The monthly roll-up follows the same narrowing (100, not 100+200+300).
    const monthly = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      spocUserId: asha.id,
    });
    expect(monthly.find((m) => m.month === '2026-06')!.total).toBe('100.00');
  });

  it('the SPOC filter can only NARROW — it never widens a caller’s scope', async () => {
    const { alpha, bhavin } = await clinicsWithSpocs();
    // A SPOC scoped to Alpha filtering by BRAVO's SPOC sees nothing, rather than
    // Bravo's data leaking through the filter.
    const alphaSpoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [alpha.id])).user;
    expect(await dashboard.statusTracker(alphaSpoc, '2026-06', [bhavin.id])).toEqual([]);
    expect(
      await dashboard.clinicTotals(alphaSpoc, {
        from: '2026-06',
        to: '2026-06',
        spocUserId: bhavin.id,
      }),
    ).toEqual([]);
  });

  it('the filter options list active SPOCs for finance and none for a clinic viewer', async () => {
    const { alpha } = await clinicsWithSpocs();
    await fx.makeUser(UserRole.CLINIC_SPOC, [alpha.id], { name: 'Retired One', active: false });

    const forFinance = await dashboard.filterOptions(finance);
    expect(forFinance.spocs.map((s) => s.name)).toEqual(['Asha Rao', 'Bhavin Shah']);

    // Clinic-scoped viewers have a single clinic and nothing to filter across.
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [alpha.id])).user;
    expect((await dashboard.filterOptions(spoc)).spocs).toEqual([]);
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

  // ── Multi-select filters: clinicIds / spocUserIds / multi-status ─────────────

  it('clinicIds narrows every aggregation to the selected subset (OR within the filter)', async () => {
    const a = await fx.makeClinic({ name: 'A' });
    const b = await fx.makeClinic({ name: 'B' });
    const c = await fx.makeClinic({ name: 'C' });
    const head = await fx.makeExpenseHead();
    for (const cl of [a, b, c]) await fx.mapHeads(cl.id, [head.id]);
    await enter(a.id, '2026-06', head.id, 100);
    await enter(b.id, '2026-06', head.id, 200);
    await enter(c.id, '2026-06', head.id, 400);

    // Two of the three clinics selected → only those two, summed (100 + 200).
    const totals = await dashboard.clinicTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      clinicIds: [a.id, b.id],
    });
    expect(totals.map((t) => t.clinicName).sort()).toEqual(['A', 'B']);

    const monthly = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      clinicIds: [a.id, b.id],
    });
    expect(monthly.find((m) => m.month === '2026-06')!.total).toBe('300.00');
  });

  it('clinicIds can only NARROW — an id outside the caller’s scope is dropped, never widens', async () => {
    const mine = await fx.makeClinic({ name: 'Mine' });
    const other = await fx.makeClinic({ name: 'Other' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(mine.id, [head.id]);
    await fx.mapHeads(other.id, [head.id]);
    await enter(mine.id, '2026-06', head.id, 100);
    await enter(other.id, '2026-06', head.id, 999);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [mine.id])).user;
    // A clinic-scoped SPOC asking for BOTH clinics only ever gets their own.
    const totals = await dashboard.clinicTotals(spoc, {
      from: '2026-06',
      to: '2026-06',
      clinicIds: [mine.id, other.id],
    });
    expect(totals.map((t) => t.clinicName)).toEqual(['Mine']);
    expect(totals[0].total).toBe('100.00');
  });

  it('spocUserIds unions the clinics of the selected SPOCs, then intersects caller scope', async () => {
    const { asha, bhavin } = await clinicsWithSpocs(); // Alpha=100, Bravo=200, Orphan=300 (no SPOC)

    // Both SPOCs selected → the UNION of their clinics (Alpha ∪ Bravo), Orphan out.
    const totals = await dashboard.clinicTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      spocUserIds: [asha.id, bhavin.id],
    });
    expect(totals.map((t) => t.clinicName).sort()).toEqual(['Alpha', 'Bravo']);

    const tiles = await dashboard.statusTracker(finance, '2026-06', [asha.id, bhavin.id]);
    expect(tiles.map((t) => t.clinicName).sort()).toEqual(['Alpha', 'Bravo']);
  });

  it('status filter accepts multiple statuses (OR within the filter)', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', head.id, 100); // submission stays NOT_STARTED

    // NOT_STARTED is one of several requested statuses → the row is included.
    const matching = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      status: [SubmissionStatus.NOT_STARTED, SubmissionStatus.DRAFT],
    });
    expect(matching).toEqual([{ month: '2026-06', total: '100.00' }]);

    // A set that excludes the real status → nothing.
    const nonMatching = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      status: [SubmissionStatus.DRAFT, SubmissionStatus.FINANCE_APPROVED],
    });
    expect(nonMatching).toEqual([]);
  });

  it('expenseHeadIds narrows aggregations to the selected heads (OR within the filter)', async () => {
    const clinic = await fx.makeClinic({ name: 'Heads' });
    const rent = await fx.makeExpenseHead({ glAccountName: 'Rent' });
    const power = await fx.makeExpenseHead({ glAccountName: 'Power' });
    const water = await fx.makeExpenseHead({ glAccountName: 'Water' });
    await fx.mapHeads(clinic.id, [rent.id, power.id, water.id]);
    await enter(clinic.id, '2026-06', rent.id, 100);
    await enter(clinic.id, '2026-06', power.id, 200);
    await enter(clinic.id, '2026-06', water.id, 400);

    // Two of three heads → the head trend shows just those, and the monthly/clinic
    // roll-ups sum only them (100 + 200), never the unselected head.
    const trends = await dashboard.headTrends(finance, {
      from: '2026-06',
      to: '2026-06',
      expenseHeadIds: [rent.id, power.id],
    });
    expect(trends.map((t) => t.expenseHeadName).sort()).toEqual(['Power', 'Rent']);

    const monthly = await dashboard.monthlyTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      expenseHeadIds: [rent.id, power.id],
    });
    expect(monthly.find((m) => m.month === '2026-06')!.total).toBe('300.00');

    const totals = await dashboard.clinicTotals(finance, {
      from: '2026-06',
      to: '2026-06',
      expenseHeadIds: [rent.id, power.id],
    });
    expect(totals.find((c) => c.clinicName === 'Heads')!.total).toBe('300.00');
  });

  // ── Step 4 — month-wise clinic report ───────────────────────────────────────

  it('month-wise report: window = current + N preceding (chronological, current last) with gaps as null', async () => {
    const clinic = await fx.makeClinic({ name: 'Reportee' });
    const head = await fx.makeExpenseHead({ glAccountName:'Rent' });
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

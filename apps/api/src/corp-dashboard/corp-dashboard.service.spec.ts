import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CorpDepartmentType, CorpSubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { CorpWorkflowService } from '../corp-submissions/corp-workflow.service';
import { CorpSubmissionsService } from '../corp-submissions/corp-submissions.service';
import { CorpProvisionEntryService } from '../corp-submissions/corp-provision-entry.service';
import { Sec24AllocationService } from '../corp-submissions/sec24-allocation.service';
import { CorpDashboardService } from './corp-dashboard.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';
import type { RequestUser } from '../auth/request-user';

const M = '2026-07';
const PRIOR = '2026-06';

/**
 * Step C4.1 — corporate consolidated dashboard. A read-only presentation layer:
 * statuses/charts match seeded data, Sec 24 dual values come from FROZEN snapshot
 * values (NULL ≠ 0), variance flags at the configurable threshold, filters +
 * scope work, and reads never audit.
 */
describe('CorpDashboardService (Step C4.1 — consolidated dashboard)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dash: CorpDashboardService;
  let entries: CorpProvisionEntryService;
  let workflow: CorpWorkflowService;
  let cycle: CorpCycleService;
  let sec24: Sec24AllocationService;
  let fx: CorpFixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        CorpExpenseHeadsService,
        CorpCycleService,
        CorpDepartmentScopeService,
        CorpWorkflowService,
        CorpSubmissionsService,
        CorpProvisionEntryService,
        Sec24AllocationService,
        CorpDashboardService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dash = moduleRef.get(CorpDashboardService);
    entries = moduleRef.get(CorpProvisionEntryService);
    workflow = moduleRef.get(CorpWorkflowService);
    cycle = moduleRef.get(CorpCycleService);
    sec24 = moduleRef.get(Sec24AllocationService);
    fx = makeCorpFixtures(prisma, cycle);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** Enter every head (by sorted name) with the given amounts, then submit+approve. */
  async function enterAndApprove(
    departmentId: string,
    month: string,
    spoc: RequestUser,
    fm: RequestUser,
    budgetCodeId: string,
    amounts: number[],
  ): Promise<string> {
    const { submission } = await cycle.openDepartmentCycle(departmentId, month);
    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
      orderBy: { expenseHeadNameAtSnapshot: 'asc' },
    });
    await entries.saveEntries(
      submission.id,
      spoc,
      snaps.map((s, i) => ({ snapshotId: s.id, budgetCodeId, amount: amounts[i] ?? 0 })),
    );
    await workflow.submit(submission.id, spoc);
    await workflow.openReview(submission.id, fm);
    await workflow.approve(submission.id, fm);
    return submission.id;
  }

  const admin = (): Promise<RequestUser> => fx.makeUser(UserRole.FINANCE_ADMIN);
  const fmUser = (): Promise<RequestUser> => fx.makeUser(UserRole.CORP_FINANCE_MANAGER);

  // ── status tracker ──────────────────────────────────────────────────────────

  it('status tracker reflects seeded statuses + totals; departments with no cycle read NOT_STARTED', async () => {
    const deptA = await fx.makeDept({ name: 'Alpha' });
    const deptB = await fx.makeDept({ name: 'Beta' });
    await fx.makeHead(deptA.id, { name: 'Salaries' });
    const codeA = await fx.makeBudgetCode(deptA.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [deptA.id, deptB.id]);
    const fm = await fmUser();
    await enterAndApprove(deptA.id, M, spoc, fm, codeA.id, [500]);

    const tiles = await dash.statusTracker(spoc, M);
    const a = tiles.find((t) => t.departmentId === deptA.id)!;
    const b = tiles.find((t) => t.departmentId === deptB.id)!;
    expect(a.status).toBe(CorpSubmissionStatus.FINANCE_APPROVED);
    expect(a.total).toBe('500.00');
    expect(b.status).toBe(CorpSubmissionStatus.NOT_STARTED);
    expect(b.total).toBeNull();
  });

  // ── month-on-month + per dept + head trends + dept totals ───────────────────

  it('combined + per-department month-on-month and head trends match seeded amounts', async () => {
    const deptA = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(deptA.id, { name: 'Salaries' });
    await fx.makeHead(deptA.id, { name: 'Travel' });
    const codeA = await fx.makeBudgetCode(deptA.id);
    const deptB = await fx.makeDept({ name: 'Beta' });
    await fx.makeHead(deptB.id, { name: 'Rent' });
    const codeB = await fx.makeBudgetCode(deptB.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [deptA.id, deptB.id]);
    const fm = await fmUser();

    await enterAndApprove(deptA.id, PRIOR, spoc, fm, codeA.id, [100, 50]); // 150
    await enterAndApprove(deptA.id, M, spoc, fm, codeA.id, [200, 80]); // 280
    await enterAndApprove(deptB.id, M, spoc, fm, codeB.id, [300]); // 300

    const monthly = await dash.monthlyTotals(spoc, { from: PRIOR, to: M });
    expect(monthly).toEqual([
      { month: PRIOR, total: '150.00' },
      { month: M, total: '580.00' }, // 280 + 300 combined
    ]);

    const perDept = await dash.departmentMonthlyTotals(spoc, { from: PRIOR, to: M });
    expect(perDept.find((r) => r.month === M && r.departmentId === deptA.id)!.total).toBe('280.00');
    expect(perDept.find((r) => r.month === M && r.departmentId === deptB.id)!.total).toBe('300.00');

    const heads = await dash.headTrends(spoc, { departmentId: deptA.id, from: M, to: M });
    expect(heads.find((h) => h.expenseHeadName === 'Salaries')!.total).toBe('200.00');
    expect(heads.find((h) => h.expenseHeadName === 'Travel')!.total).toBe('80.00');

    // departmentTotals is a range rollup; pin a single month with from=to=M.
    const deptTotals = await dash.departmentTotals(spoc, { from: M, to: M });
    expect(deptTotals.find((d) => d.departmentId === deptA.id)!.total).toBe('280.00');
    expect(deptTotals.find((d) => d.departmentId === deptB.id)!.total).toBe('300.00');
    // Over the full PRIOR–M range deptA accumulates both months (150 + 280).
    const deptTotalsRange = await dash.departmentTotals(spoc, { from: PRIOR, to: M });
    expect(deptTotalsRange.find((d) => d.departmentId === deptA.id)!.total).toBe('430.00');
  });

  // ── filters ─────────────────────────────────────────────────────────────────

  it('filters by department, expense head, budget code and status', async () => {
    const dept = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(dept.id, { name: 'Salaries' });
    await fx.makeHead(dept.id, { name: 'Travel' });
    const code1 = await fx.makeBudgetCode(dept.id, { code: 'BR-1' });
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    const subId = await enterAndApprove(dept.id, M, spoc, fm, code1.id, [200, 80]);

    // expense-head filter: only Salaries.
    const head = await prisma.corpExpenseHead.findFirstOrThrow({ where: { name: 'Salaries' } });
    const byHead = await dash.monthlyTotals(spoc, { month: M, expenseHeadId: head.id });
    expect(byHead).toEqual([{ month: M, total: '200.00' }]);

    // budget-code filter: all lines used code1 → full total; an unused code → empty.
    const byCode = await dash.monthlyTotals(spoc, { month: M, budgetCodeId: code1.id });
    expect(byCode).toEqual([{ month: M, total: '280.00' }]);
    const otherCode = await fx.makeBudgetCode(dept.id, { code: 'BR-2' });
    expect(await dash.monthlyTotals(spoc, { month: M, budgetCodeId: otherCode.id })).toEqual([]);

    // status filter: FINANCE_APPROVED matches, DRAFT excludes.
    expect(
      await dash.monthlyTotals(spoc, { month: M, status: [CorpSubmissionStatus.FINANCE_APPROVED] }),
    ).toEqual([{ month: M, total: '280.00' }]);
    expect(
      await dash.monthlyTotals(spoc, { month: M, status: [CorpSubmissionStatus.DRAFT] }),
    ).toEqual([]);
    expect(subId).toBeDefined();
  });

  // ── department scope ────────────────────────────────────────────────────────

  it('a DEPT_SPOC sees only assigned departments; an approver sees all', async () => {
    const deptA = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(deptA.id);
    const codeA = await fx.makeBudgetCode(deptA.id);
    const deptB = await fx.makeDept({ name: 'Beta' });
    await fx.makeHead(deptB.id);
    const codeB = await fx.makeBudgetCode(deptB.id);
    const spocA = await fx.makeUser(UserRole.DEPT_SPOC, [deptA.id]);
    const fm = await fmUser();
    await enterAndApprove(deptA.id, M, spocA, fm, codeA.id, [100]);
    const spocB = await fx.makeUser(UserRole.DEPT_SPOC, [deptB.id]);
    await enterAndApprove(deptB.id, M, spocB, fm, codeB.id, [200]);

    const spocTiles = await dash.statusTracker(spocA, M);
    expect(spocTiles.map((t) => t.departmentId)).toEqual([deptA.id]); // only own dept

    const fmTotals = await dash.departmentTotals(fm, { month: M });
    expect(fmTotals.map((d) => d.departmentId).sort()).toEqual([deptA.id, deptB.id].sort());
  });

  // ── Sec 24 dual display — frozen, NULL ≠ 0 ──────────────────────────────────

  it('Sec 24: amounts approved with NO % set → share and % are NULL ("—"), never 0', async () => {
    const dept = await fx.makeDept({ name: 'Sec24', type: CorpDepartmentType.SHARED_COST_POOL });
    await fx.makeHead(dept.id, { name: 'Pooled' });
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    await enterAndApprove(dept.id, M, spoc, fm, code.id, [1000]);

    const [row] = await dash.sec24Dual(fm, { from: M, to: M });
    expect(row.total).toBe('1000.00');
    expect(row.hclAvitasShare).toBeNull(); // not '0.00'
    expect(row.allocationPct).toBeNull(); // not '0.00'
  });

  it('Sec 24: approved WITH a % → frozen share + % used; a later % change does not move it', async () => {
    const dept = await fx.makeDept({ name: 'Sec24', type: CorpDepartmentType.SHARED_COST_POOL });
    await fx.makeHead(dept.id, { name: 'Pooled' });
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    const adminUser = await admin();
    await sec24.setAllocation(adminUser, { allocationPct: 10, effectiveFromMonth: M });
    await enterAndApprove(dept.id, M, spoc, fm, code.id, [1000]);

    let [row] = await dash.sec24Dual(fm, { from: M, to: M });
    expect(row.total).toBe('1000.00');
    expect(row.hclAvitasShare).toBe('100.00'); // 1000 × 10%
    expect(row.allocationPct).toBe('10.00');

    // Change the % afterward — the approved month stays frozen.
    await sec24.setAllocation(adminUser, { allocationPct: 25, effectiveFromMonth: M });
    [row] = await dash.sec24Dual(fm, { from: M, to: M });
    expect(row.hclAvitasShare).toBe('100.00');
    expect(row.allocationPct).toBe('10.00');
  });

  it('Sec 24: a real 0% allocation is distinct from "no % set" (0.00, not NULL)', async () => {
    const dept = await fx.makeDept({ name: 'Sec24', type: CorpDepartmentType.SHARED_COST_POOL });
    await fx.makeHead(dept.id, { name: 'Pooled' });
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    const adminUser = await admin();
    await sec24.setAllocation(adminUser, { allocationPct: 0, effectiveFromMonth: M });
    await enterAndApprove(dept.id, M, spoc, fm, code.id, [1000]);

    const [row] = await dash.sec24Dual(fm, { from: M, to: M });
    expect(row.allocationPct).toBe('0.00'); // a real 0% — NOT null
    expect(row.hclAvitasShare).toBe('0.00'); // 1000 × 0% = 0.00 — NOT null
  });

  // ── variance at the configurable threshold ──────────────────────────────────

  it('variance flags a head beyond the CONFIGURED threshold; no config → no threshold, no flags', async () => {
    const dept = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(dept.id, { name: 'Salaries' });
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    await enterAndApprove(dept.id, PRIOR, spoc, fm, code.id, [100]);
    await enterAndApprove(dept.id, M, spoc, fm, code.id, [200]); // +100% vs prior

    // No NotificationConfig → null threshold, nothing flagged.
    const noConfig = await dash.variance(fm, M, dept.id);
    expect(noConfig.thresholdPercent).toBeNull();
    expect(noConfig.rows.every((r) => !r.flagged)).toBe(true);

    // Threshold 50% → +100% breaches it.
    await prisma.notificationConfig.create({
      data: {
        month: M,
        monthStartNotifyDate: new Date(),
        cutoffDate: new Date(),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: new Prisma.Decimal(50),
      },
    });
    const flagged = await dash.variance(fm, M, dept.id);
    expect(flagged.thresholdPercent).toBe('50.00');
    const salaries = flagged.rows.find((r) => r.expenseHeadName === 'Salaries')!;
    expect(salaries.deviationPercent).toBe('100.00');
    expect(salaries.flagged).toBe(true);
  });

  // ── reads never audit ───────────────────────────────────────────────────────

  it('dashboard reads write no audit rows and change no submission state', async () => {
    const dept = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(dept.id);
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fmUser();
    const subId = await enterAndApprove(dept.id, M, spoc, fm, code.id, [100]);

    const auditBefore = await prisma.auditLog.count();
    const statusBefore = (
      await prisma.corpMonthlySubmission.findUniqueOrThrow({ where: { id: subId } })
    ).status;

    await dash.statusTracker(fm, M);
    await dash.monthlyTotals(fm, { month: M });
    await dash.departmentMonthlyTotals(fm, { month: M });
    await dash.headTrends(fm, { month: M });
    await dash.departmentTotals(fm, { month: M });
    await dash.sec24Dual(fm, { month: M });
    await dash.variance(fm, M);
    await dash.filterOptions(fm);

    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(
      (await prisma.corpMonthlySubmission.findUniqueOrThrow({ where: { id: subId } })).status,
    ).toBe(statusBefore);
  });

  // ── filter options ──────────────────────────────────────────────────────────

  it('filter options are scoped: a SPOC gets only their dept, its heads and codes', async () => {
    const deptA = await fx.makeDept({ name: 'Alpha' });
    await fx.makeHead(deptA.id, { name: 'Salaries' });
    await fx.makeBudgetCode(deptA.id, { code: 'BR-1' });
    const deptB = await fx.makeDept({ name: 'Beta' });
    await fx.makeHead(deptB.id, { name: 'Rent' });
    await fx.makeBudgetCode(deptB.id, { code: 'BR-2' });
    const spocA = await fx.makeUser(UserRole.DEPT_SPOC, [deptA.id]);

    const opts = await dash.filterOptions(spocA);
    expect(opts.departments.map((d) => d.id)).toEqual([deptA.id]);
    expect(opts.expenseHeads.map((h) => h.name)).toEqual(['Salaries']);
    expect(opts.budgetCodes.map((c) => c.code)).toEqual(['BR-1']);
  });
});

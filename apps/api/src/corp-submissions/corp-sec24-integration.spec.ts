import { Test, type TestingModule } from '@nestjs/testing';
import { CorpDepartmentType, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from './corp-cycle.service';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { CorpWorkflowService } from './corp-workflow.service';
import { CorpSubmissionsService } from './corp-submissions.service';
import { CorpProvisionEntryService } from './corp-provision-entry.service';
import { Sec24AllocationService } from './sec24-allocation.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

/**
 * Step C3.1 — Sec 24 end to end: the HCL Avitas share appears only after a % is
 * set (BR-C04, no re-save needed), approval snapshots the % onto the submission
 * and freezes the per-line share (BR-C05), and a later % change never disturbs an
 * already-approved submission. Non-pool departments never show a share.
 */
describe('Corporate Sec 24 share + snapshot (Step C3.1 integration)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let entries: CorpProvisionEntryService;
  let workflow: CorpWorkflowService;
  let submissions: CorpSubmissionsService;
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
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    entries = moduleRef.get(CorpProvisionEntryService);
    workflow = moduleRef.get(CorpWorkflowService);
    submissions = moduleRef.get(CorpSubmissionsService);
    sec24 = moduleRef.get(Sec24AllocationService);
    fx = makeCorpFixtures(prisma, moduleRef.get(CorpCycleService));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function poolScenario() {
    const dept = await fx.makeDept({ type: CorpDepartmentType.SHARED_COST_POOL });
    await fx.makeHead(dept.id, { name: 'Pooled cost' });
    const code = await fx.makeBudgetCode(dept.id, { code: 'BR-C01' });
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fx.makeUser(UserRole.CORP_FINANCE_MANAGER);
    const admin = await fx.makeUser(UserRole.FINANCE_ADMIN);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    const [snap] = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    return { dept, code, spoc, fm, admin, submissionId: submission.id, snapshotId: snap.id };
  }

  it('amounts can be entered before any % is set; the share shows "—" (null) until then', async () => {
    const { code, spoc, submissionId, snapshotId } = await poolScenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId, budgetCodeId: code.id, amount: 1000 },
    ]);

    const detail = await submissions.getDetail(submissionId, spoc);
    expect(detail.isSharedCostPool).toBe(true);
    expect(detail.sec24AllocationPct).toBeNull();
    expect(detail.heads[0].amount).toBe('1000.00');
    expect(detail.heads[0].hclAvitasShare).toBeNull();
  });

  it('once a % is set, the share computes in real time — no re-save of the line', async () => {
    const { code, spoc, admin, submissionId, snapshotId } = await poolScenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId, budgetCodeId: code.id, amount: 1000 },
    ]);
    // % set AFTER the amount was entered; no further save of the line.
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: MONTH });

    const detail = await submissions.getDetail(submissionId, spoc);
    expect(detail.sec24AllocationPct).toBe('10.00');
    expect(detail.heads[0].hclAvitasShare).toBe('100.00'); // 1000 × 10%
  });

  it('approval snapshots the % onto the submission and freezes the per-line share (BR-C05)', async () => {
    const { code, spoc, fm, admin, submissionId, snapshotId } = await poolScenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId, budgetCodeId: code.id, amount: 1000 },
    ]);
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: MONTH });
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    const stored = await prisma.corpMonthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(stored.sec24PctSnapshot?.toFixed(2)).toBe('10.00');
    const entry = await prisma.corpProvisionEntry.findUniqueOrThrow({ where: { snapshotId } });
    expect(entry.hclAvitasShare?.toFixed(2)).toBe('100.00');
  });

  it('a later % change never disturbs an already-approved submission (frozen history)', async () => {
    const { code, spoc, fm, admin, submissionId, snapshotId } = await poolScenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId, budgetCodeId: code.id, amount: 1000 },
    ]);
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: MONTH });
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    // Admin changes the % for the SAME month afterward (a new append row).
    await sec24.setAllocation(admin, { allocationPct: 25, effectiveFromMonth: MONTH });
    expect((await sec24.activePctForMonth(MONTH))!.toFixed(2)).toBe('25.00'); // change took effect generally

    // …but the approved submission stays frozen at the snapshot %.
    const detail = await submissions.getDetail(submissionId, admin);
    expect(detail.sec24AllocationPct).toBe('10.00');
    expect(detail.heads[0].hclAvitasShare).toBe('100.00');
    const entry = await prisma.corpProvisionEntry.findUniqueOrThrow({ where: { snapshotId } });
    expect(entry.hclAvitasShare?.toFixed(2)).toBe('100.00');
  });

  it('approving with no % set stores a null snapshot and the share stays "—"', async () => {
    const { code, spoc, fm, submissionId, snapshotId } = await poolScenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId, budgetCodeId: code.id, amount: 1000 },
    ]);
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    const stored = await prisma.corpMonthlySubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(stored.sec24PctSnapshot).toBeNull();
    const detail = await submissions.getDetail(submissionId, spoc);
    expect(detail.heads[0].hclAvitasShare).toBeNull();
  });

  it('a non-pool department never shows a share, even when a % exists', async () => {
    const dept = await fx.makeDept({ type: CorpDepartmentType.STANDARD });
    await fx.makeHead(dept.id);
    const code = await fx.makeBudgetCode(dept.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const admin = await fx.makeUser(UserRole.FINANCE_ADMIN);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    const [snap] = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
    });
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: MONTH });
    await entries.saveEntries(submission.id, spoc, [
      { snapshotId: snap.id, budgetCodeId: code.id, amount: 1000 },
    ]);

    const detail = await submissions.getDetail(submission.id, spoc);
    expect(detail.isSharedCostPool).toBe(false);
    expect(detail.sec24AllocationPct).toBeNull();
    expect(detail.heads[0].hclAvitasShare).toBeNull();
  });
});

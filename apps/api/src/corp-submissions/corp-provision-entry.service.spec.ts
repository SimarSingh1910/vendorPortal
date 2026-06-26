import { Test, type TestingModule } from '@nestjs/testing';
import { CorpSubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from './corp-cycle.service';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { CorpWorkflowService } from './corp-workflow.service';
import { CorpSubmissionsService } from './corp-submissions.service';
import { CorpProvisionEntryService } from './corp-provision-entry.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

const MONTH = '2026-07';

/**
 * Step C2.2/C2.3 — corporate provision entry (SPOC) + approver value override.
 * Every line carries a mandatory budget code from the department's active codes
 * (BR-C01/BR-C02); approver edits during the review window are audited (BR-C08).
 */
describe('CorpProvisionEntryService (Steps C2.2/C2.3 — entry + override)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let entries: CorpProvisionEntryService;
  let workflow: CorpWorkflowService;
  let cycle: CorpCycleService;
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
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    entries = moduleRef.get(CorpProvisionEntryService);
    workflow = moduleRef.get(CorpWorkflowService);
    cycle = moduleRef.get(CorpCycleService);
    fx = makeCorpFixtures(prisma, cycle);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function scenario() {
    const dept = await fx.makeDept();
    await fx.makeHead(dept.id, { name: 'Salaries' });
    await fx.makeHead(dept.id, { name: 'Travel' });
    const code = await fx.makeBudgetCode(dept.id, { code: 'BR-C01' });
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fx.makeUser(UserRole.CORP_FINANCE_MANAGER);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
      orderBy: { expenseHeadNameAtSnapshot: 'asc' },
    });
    return { dept, code, spoc, fm, submissionId: submission.id, snaps };
  }

  // ── SPOC entry ───────────────────────────────────────────────────────────────

  it('SPOC partial save writes lines (budget code + amount) and moves the cycle to DRAFT', async () => {
    const { code, spoc, submissionId, snaps } = await scenario();

    const detail = await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 0 }, // 0 is valid (BR-C16)
    ]);

    expect(detail.status).toBe(CorpSubmissionStatus.DRAFT);
    const row = detail.heads.find((h) => h.snapshotId === snaps[0].id)!;
    expect(row.budgetCodeId).toBe(code.id);
    expect(row.amount).toBe('0.00');
    // The other head stays blank (partial save).
    expect(detail.heads.find((h) => h.snapshotId === snaps[1].id)!.amount).toBeNull();
  });

  it('rejects a line whose budget code is inactive or from another department (400)', async () => {
    const { dept, code, spoc, submissionId, snaps } = await scenario();
    const inactive = await fx.makeBudgetCode(dept.id, { code: 'OLD', active: false });
    const otherDept = await fx.makeDept();
    const foreign = await fx.makeBudgetCode(otherDept.id, { code: 'BR-X' });

    await expectStatus(
      entries.saveEntries(submissionId, spoc, [
        { snapshotId: snaps[0].id, budgetCodeId: inactive.id, amount: 10 },
      ]),
      400,
    );
    await expectStatus(
      entries.saveEntries(submissionId, spoc, [
        { snapshotId: snaps[0].id, budgetCodeId: foreign.id, amount: 10 },
      ]),
      400,
    );
    // The valid code still works.
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 10 },
    ]);
  });

  it('rejects an unknown snapshot head (400)', async () => {
    const { code, spoc, submissionId } = await scenario();
    await expectStatus(
      entries.saveEntries(submissionId, spoc, [
        { snapshotId: 'nope', budgetCodeId: code.id, amount: 10 },
      ]),
      400,
    );
  });

  it('a SPOC of another department cannot save (403); a DEPT_VIEWER cannot save (403)', async () => {
    const { dept, code, submissionId, snaps } = await scenario();
    const otherDept = await fx.makeDept();
    const otherSpoc = await fx.makeUser(UserRole.DEPT_SPOC, [otherDept.id]);
    const viewer = await fx.makeUser(UserRole.DEPT_VIEWER, [dept.id]);

    await expectStatus(
      entries.saveEntries(submissionId, otherSpoc, [
        { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 10 },
      ]),
      403,
    );
    await expectStatus(
      entries.saveEntries(submissionId, viewer, [
        { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 10 },
      ]),
      403,
    );
  });

  it('a SPOC save is audited once as CORP_PROVISION_SAVE (no double row from SAVE_DRAFT)', async () => {
    const { code, spoc, submissionId, snaps } = await scenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 5 },
    ]);
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'CorpMonthlySubmission', entityId: submissionId },
    });
    const actions = rows.map((r) => r.action);
    // Exactly one save row, and the SAVE_DRAFT transition it triggers adds none
    // (the cycle-open row is unrelated bookkeeping on the same entity).
    expect(actions.filter((a) => a === 'CORP_PROVISION_SAVE')).toHaveLength(1);
    expect(actions).not.toContain('CORP_SUBMISSION_SAVE_DRAFT');
  });

  // ── approver override (BR-C08) ─────────────────────────────────────────────────

  it('an approver may override a value during review — audited old→new, status unchanged, provenance kept', async () => {
    const { code, spoc, fm, submissionId, snaps } = await scenario();
    // SPOC fills both heads, then submits.
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 100 },
      { snapshotId: snaps[1].id, budgetCodeId: code.id, amount: 200 },
    ]);
    await workflow.submit(submissionId, spoc);

    // Approver edits a value while SUBMITTED (no open required for editing).
    const detail = await entries.saveEntries(submissionId, fm, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 150 },
    ]);
    expect(detail.status).toBe(CorpSubmissionStatus.SUBMITTED); // status unchanged

    const entry = await prisma.corpProvisionEntry.findUniqueOrThrow({
      where: { snapshotId: snaps[0].id },
    });
    expect(entry.amount.toFixed(2)).toBe('150.00');
    expect(entry.enteredById).toBe(spoc.id); // provenance preserved
    expect(entry.lastModifiedById).toBe(fm.id);

    const override = await prisma.auditLog.findFirst({
      where: { action: 'CORP_PROVISION_EDIT_OVERRIDE', entityId: submissionId },
    });
    expect(override).not.toBeNull();
  });

  it('an approver cannot edit while the submission is still with the SPOC (DRAFT → 409)', async () => {
    const { code, spoc, fm, submissionId, snaps } = await scenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 100 },
    ]); // → DRAFT
    await expectStatus(
      entries.saveEntries(submissionId, fm, [
        { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 1 },
      ]),
      409,
    );
  });

  it('no one can save through a locked (FINANCE_APPROVED) submission (403)', async () => {
    const { code, spoc, fm, submissionId, snaps } = await scenario();
    await entries.saveEntries(submissionId, spoc, [
      { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 100 },
      { snapshotId: snaps[1].id, budgetCodeId: code.id, amount: 200 },
    ]);
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    await expectStatus(
      entries.saveEntries(submissionId, fm, [
        { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 999 },
      ]),
      403,
    );
    await expectStatus(
      entries.saveEntries(submissionId, spoc, [
        { snapshotId: snaps[0].id, budgetCodeId: code.id, amount: 999 },
      ]),
      403,
    );
  });

  it('end-to-end: a SPOC who fills EVERY head with a code+value can then submit (BR-C01/BR-C16)', async () => {
    const { code, spoc, submissionId, snaps } = await scenario();
    await entries.saveEntries(
      submissionId,
      spoc,
      snaps.map((s) => ({ snapshotId: s.id, budgetCodeId: code.id, amount: 100 })),
    );
    const submitted = await workflow.submit(submissionId, spoc);
    expect(submitted.status).toBe(CorpSubmissionStatus.SUBMITTED);
  });
});

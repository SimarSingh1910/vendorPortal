import { Test, type TestingModule } from '@nestjs/testing';
import { CorpSubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from './corp-cycle.service';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { CorpWorkflowService } from './corp-workflow.service';
import { Sec24AllocationService } from './sec24-allocation.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

const MONTH = '2026-07';
const St = CorpSubmissionStatus;

/**
 * Step C2.2/C2.3 — the authoritative corporate state machine. 2-level lifecycle
 * with no intermediate approver, conditional-update concurrency, in-tx comments,
 * structurally no skipped states, and a Finance-Admin-only unlock.
 */
describe('CorpWorkflowService (Steps C2.2/C2.3 — corporate state machine)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
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
        Sec24AllocationService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
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

  /** A dept with 2 active heads + a budget code, an open cycle, a SPOC and an approver. */
  async function scenario(opts: { value?: boolean; leaveUnvalued?: number } = {}) {
    const dept = await fx.makeDept();
    await fx.makeHead(dept.id, { name: 'Salaries' });
    await fx.makeHead(dept.id, { name: 'Travel' });
    const code = await fx.makeBudgetCode(dept.id, { code: 'BR-C01' });
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fx.makeUser(UserRole.CORP_FINANCE_MANAGER);
    const admin = await fx.makeUser(UserRole.FINANCE_ADMIN);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    if (opts.value) {
      await fx.valueAllHeads(submission.id, code.id, spoc.id, { leaveUnvalued: opts.leaveUnvalued });
    }
    return { dept, code, spoc, fm, admin, submissionId: submission.id };
  }

  // ── happy path ───────────────────────────────────────────────────────────────

  it('SPOC submit → approver open → approve locks (financeApprovedAt + lockedAt set)', async () => {
    const { spoc, fm, submissionId } = await scenario({ value: true });

    const submitted = await workflow.submit(submissionId, spoc);
    expect(submitted.status).toBe(St.SUBMITTED);
    expect(submitted.submittedAt).not.toBeNull();

    const inReview = await workflow.openReview(submissionId, fm);
    expect(inReview.status).toBe(St.FINANCE_MANAGER_REVIEW);

    const approved = await workflow.approve(submissionId, fm);
    expect(approved.status).toBe(St.FINANCE_APPROVED);
    expect(approved.financeApprovedAt).not.toBeNull();
    expect(approved.lockedAt).not.toBeNull();
  });

  // ── BR-C16 submit gating ───────────────────────────────────────────────────────

  it('submit is blocked (422) when any active head lacks a complete line', async () => {
    const { spoc, submissionId } = await scenario({ value: true, leaveUnvalued: 1 });
    await expectStatus(workflow.submit(submissionId, spoc), 422);
  });

  it('submit is blocked (422) when the department has no active heads', async () => {
    const dept = await fx.makeDept();
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    await expectStatus(workflow.submit(submission.id, spoc), 422);
  });

  // ── send-back → revise → resubmit ──────────────────────────────────────────────

  it('send-back requires a comment, returns to SPOC, and resubmit re-enters the approver queue', async () => {
    const { spoc, fm, submissionId } = await scenario({ value: true });
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);

    // Missing comment → 400.
    await expectStatus(workflow.sendBack(submissionId, fm, '   '), 400);

    const sentBack = await workflow.sendBack(submissionId, fm, 'Please fix the travel line');
    expect(sentBack.status).toBe(St.SENT_BACK_TO_SPOC);

    const comments = await prisma.corpSubmissionComment.findMany({ where: { submissionId } });
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe('Please fix the travel line');

    // SPOC revises (re-save keeps it editable) and resubmits → back to SUBMITTED.
    const resubmitted = await workflow.submit(submissionId, spoc);
    expect(resubmitted.status).toBe(St.SUBMITTED);
  });

  // ── structurally no skipped states ─────────────────────────────────────────────

  it('cannot approve a SUBMITTED item without opening review first (409)', async () => {
    const { spoc, fm, submissionId } = await scenario({ value: true });
    await workflow.submit(submissionId, spoc);
    await expectStatus(workflow.approve(submissionId, fm), 409);
  });

  it('cannot open review on a DRAFT item (409)', async () => {
    const { spoc, fm, submissionId } = await scenario({ value: true });
    await workflow.saveDraft(submissionId, spoc); // → DRAFT
    await expectStatus(workflow.openReview(submissionId, fm), 409);
  });

  // ── scope + role ───────────────────────────────────────────────────────────────

  it('a SPOC cannot act on a department they are not assigned to (403)', async () => {
    const { submissionId } = await scenario({ value: true });
    const otherDept = await fx.makeDept();
    const otherSpoc = await fx.makeUser(UserRole.DEPT_SPOC, [otherDept.id]);
    await expectStatus(workflow.submit(submissionId, otherSpoc), 403);
  });

  it('a SPOC assigned to MULTIPLE departments can submit either', async () => {
    const deptA = await fx.makeDept();
    const deptB = await fx.makeDept();
    await fx.makeHead(deptA.id);
    await fx.makeHead(deptB.id);
    const codeA = await fx.makeBudgetCode(deptA.id);
    const codeB = await fx.makeBudgetCode(deptB.id);
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [deptA.id, deptB.id]);
    const a = await fx.openCycle(deptA.id, MONTH);
    const b = await fx.openCycle(deptB.id, MONTH);
    await fx.valueAllHeads(a.submission.id, codeA.id, spoc.id);
    await fx.valueAllHeads(b.submission.id, codeB.id, spoc.id);

    expect((await workflow.submit(a.submission.id, spoc)).status).toBe(St.SUBMITTED);
    expect((await workflow.submit(b.submission.id, spoc)).status).toBe(St.SUBMITTED);
  });

  it('a DEPT_VIEWER cannot submit (403); a DEPT_SPOC cannot approve (403)', async () => {
    const { dept, spoc, fm, submissionId } = await scenario({ value: true });
    const viewer = await fx.makeUser(UserRole.DEPT_VIEWER, [dept.id]);
    await expectStatus(workflow.submit(submissionId, viewer), 403);

    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await expectStatus(workflow.approve(submissionId, spoc), 403);
  });

  it('a Finance Admin can act on ANY department (org-wide approver)', async () => {
    const { spoc, admin, submissionId } = await scenario({ value: true });
    await workflow.submit(submissionId, spoc);
    expect((await workflow.openReview(submissionId, admin)).status).toBe(St.FINANCE_MANAGER_REVIEW);
    expect((await workflow.approve(submissionId, admin)).status).toBe(St.FINANCE_APPROVED);
  });

  // ── audit ────────────────────────────────────────────────────────────────────

  it('records CORP_SUBMISSION_<ACTION> audit rows for transitions (not for SAVE_DRAFT)', async () => {
    const { spoc, fm, submissionId } = await scenario({ value: true });
    await workflow.saveDraft(submissionId, spoc);
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    const actions = (
      await prisma.auditLog.findMany({
        where: { entityType: 'CorpMonthlySubmission', entityId: submissionId },
        orderBy: { performedAt: 'asc' },
      })
    ).map((r) => r.action);
    expect(actions).toContain('CORP_SUBMISSION_SUBMIT');
    expect(actions).toContain('CORP_SUBMISSION_OPEN_REVIEW');
    expect(actions).toContain('CORP_SUBMISSION_APPROVE');
    expect(actions).not.toContain('CORP_SUBMISSION_SAVE_DRAFT');
  });

  // ── admin-only unlock ──────────────────────────────────────────────────────────

  it('Finance Admin unlocks an approved submission with a mandatory, audited reason', async () => {
    const { spoc, fm, admin, submissionId } = await scenario({ value: true });
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    // Empty reason → 400.
    await expectStatus(workflow.unlock(submissionId, admin, '  '), 400);

    const unlocked = await workflow.unlock(submissionId, admin, 'Correcting an approved figure');
    expect(unlocked.status).toBe(St.FINANCE_MANAGER_REVIEW);
    expect(unlocked.lockedAt).toBeNull();
    expect(unlocked.financeApprovedAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'CORP_UNLOCK', entityId: submissionId },
    });
    expect(audit).not.toBeNull();
    expect((audit!.newValue as { reason?: string }).reason).toBe('Correcting an approved figure');
  });

  it('a CORP_FINANCE_MANAGER cannot unlock (403); unlocking a non-approved item is 409', async () => {
    const { spoc, fm, admin, submissionId } = await scenario({ value: true });
    await workflow.submit(submissionId, spoc);
    await workflow.openReview(submissionId, fm);
    await workflow.approve(submissionId, fm);

    await expectStatus(workflow.unlock(submissionId, fm, 'nope'), 403);

    // Unlock back to review, then a second unlock must 409 (no longer approved).
    await workflow.unlock(submissionId, admin, 'first unlock');
    await expectStatus(workflow.unlock(submissionId, admin, 'again'), 409);
  });
});

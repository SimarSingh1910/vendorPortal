import { Test, type TestingModule } from '@nestjs/testing';
import { CommentAction } from '@prisma/client';
import { AuditAction, SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionsService } from './submissions.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

describe('WorkflowService (Step 5.2 — state machine + transition guards)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let submissions: SubmissionsService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        SubmissionsService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    submissions = moduleRef.get(SubmissionsService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** A clinic + opened cycle with `headCount` mapped heads. */
  async function openWithHeads(headCount: number) {
    const clinic = await fx.makeClinic();
    const heads = [];
    for (let i = 0; i < headCount; i += 1) {
      heads.push(await fx.makeExpenseHead());
    }
    if (heads.length > 0) {
      await fx.mapHeads(clinic.id, heads.map((h) => h.id));
    }
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    return { clinic, submission };
  }

  function reload(id: string) {
    return prisma.monthlySubmission.findUniqueOrThrow({ where: { id } });
  }

  it('happy path advances through every state and stamps the right fields', async () => {
    const { clinic, submission } = await openWithHeads(2);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });

    await workflow.submit(submission.id, spoc);
    let s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.SUBMITTED);
    expect(s.submittedAt).not.toBeNull();

    await workflow.managerOpenReview(submission.id, manager);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    expect(s.reviewStartedAt).not.toBeNull();
    expect(s.reviewStartedById).toBe(manager.id);

    await workflow.managerApprove(submission.id, manager);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.CLINIC_APPROVED);
    expect(s.approvedByManagerAt).not.toBeNull();

    await workflow.financeOpenReview(submission.id, finance);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_REVIEW);
    expect(s.reviewStartedById).toBe(finance.id); // re-stamped by the finance reviewer

    await workflow.financeApprove(submission.id, finance);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_APPROVED);
    expect(s.approvedByFinanceAt).not.toBeNull();
    expect(s.lockedAt).not.toBeNull();
  });

  // ── Step 3 — optional SPOC note on submit ───────────────────────────────────

  it('submit with a note writes exactly one SUBMITTED comment (authored by the SPOC) and no extra audit row', async () => {
    const { clinic, submission } = await openWithHeads(2);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });

    await workflow.submit(submission.id, spoc, '  Rent spiked due to the lease renewal.  ');
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.SUBMITTED);

    const comments = await prisma.submissionComment.findMany({ where: { submissionId: submission.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      action: CommentAction.SUBMITTED,
      commentedById: spoc.id,
      roleAtTime: UserRole.CLINIC_SPOC,
      comment: 'Rent spiked due to the lease renewal.', // trimmed
    });

    // SUBMIT still audits exactly once — the comment is timeline data, not audit.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'SUBMISSION_SUBMIT' },
    });
    expect(audits).toHaveLength(1);
  });

  it('submit without a note writes no comment row (and still audits the submit)', async () => {
    const { clinic, submission } = await openWithHeads(1);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });

    await workflow.submit(submission.id, spoc); // no note
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.SUBMITTED);

    expect(await prisma.submissionComment.count({ where: { submissionId: submission.id } })).toBe(0);
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'SUBMISSION_SUBMIT' },
    });
    expect(audits).toHaveLength(1);
  });

  it('an all-whitespace note is treated as empty — no comment row', async () => {
    const { clinic, submission } = await openWithHeads(1);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });

    await workflow.submit(submission.id, spoc, '   ');
    expect(await prisma.submissionComment.count({ where: { submissionId: submission.id } })).toBe(0);
  });

  it('BR-03: submit fails (422) with an unvalued head; BR-07: succeeds when every head valued including 0', async () => {
    // BR-03 negative — one head left blank.
    const a = await openWithHeads(3);
    const spocA = (await fx.makeUser(UserRole.CLINIC_SPOC, [a.clinic.id])).user;
    await fx.valueAllHeads(a.submission.id, { enteredById: spocA.id, leaveUnvalued: 1 });
    await expectStatus(workflow.submit(a.submission.id, spocA), 422);
    expect((await reload(a.submission.id)).status).toBe(SubmissionStatus.NOT_STARTED);

    // BR-07 — all heads valued, one of them explicitly 0.
    const b = await openWithHeads(2);
    const spocB = (await fx.makeUser(UserRole.CLINIC_SPOC, [b.clinic.id])).user;
    await fx.valueAllHeads(b.submission.id, { enteredById: spocB.id, amount: 0 });
    await workflow.submit(b.submission.id, spocB);
    expect((await reload(b.submission.id)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  it('rejects submit on a clinic with no mapped heads (422)', async () => {
    const { clinic, submission } = await openWithHeads(0);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    await expectStatus(workflow.submit(submission.id, spoc), 422);
  });

  it('rejects illegal transitions with the documented codes', async () => {
    // Manager approves a DRAFT → 409 (wrong from-state).
    const draft = await openWithHeads(1);
    await fx.driveToStatus(draft.submission.id, SubmissionStatus.DRAFT);
    const mgrDraft = (await fx.makeUser(UserRole.CLINIC_MANAGER, [draft.clinic.id])).user;
    await expectStatus(workflow.managerApprove(draft.submission.id, mgrDraft), 409);

    // Finance approves something not in FINANCE_REVIEW → 409.
    const approved = await openWithHeads(1);
    await fx.driveToStatus(approved.submission.id, SubmissionStatus.CLINIC_APPROVED);
    const fin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    await expectStatus(workflow.financeApprove(approved.submission.id, fin), 409);

    // SPOC acts on a FINANCE_APPROVED (locked) submission → 409.
    const locked = await openWithHeads(1);
    await fx.driveToStatus(locked.submission.id, SubmissionStatus.FINANCE_APPROVED);
    const spocLocked = (await fx.makeUser(UserRole.CLINIC_SPOC, [locked.clinic.id])).user;
    await expectStatus(workflow.submit(locked.submission.id, spocLocked), 409);

    // Non-SPOC attempting a SPOC action → 403 (role check before state).
    const draft2 = await openWithHeads(1);
    await fx.driveToStatus(draft2.submission.id, SubmissionStatus.DRAFT);
    const mgr2 = (await fx.makeUser(UserRole.CLINIC_MANAGER, [draft2.clinic.id])).user;
    await expectStatus(workflow.submit(draft2.submission.id, mgr2), 403);

    // Missing submission → 404.
    const someSpoc = (await fx.makeUser(UserRole.CLINIC_SPOC)).user;
    await expectStatus(workflow.submit('no-such-submission', someSpoc), 404);
  });

  it('BR-04: a finance send-back forces SPOC → Manager → Finance again (no direct finance edge)', async () => {
    const { clinic, submission } = await openWithHeads(1);
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_REVIEW);

    // Finance sends back (comment required) → SPOC-actionable.
    await workflow.financeSendBack(submission.id, actors.finance, 'Please revise the rent figure');
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.SENT_BACK_BY_FINANCE);

    // SPOC resubmits (entries still present from the drive) → SUBMITTED.
    await workflow.submit(submission.id, actors.spoc);
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.SUBMITTED);

    // Finance CANNOT jump straight back in — no SUBMITTED → FINANCE_* edge.
    await expectStatus(workflow.financeOpenReview(submission.id, actors.finance), 409);
    await expectStatus(workflow.financeApprove(submission.id, actors.finance), 409);

    // The only forward path is through the Manager again.
    await workflow.managerOpenReview(submission.id, actors.manager);
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await workflow.managerApprove(submission.id, actors.manager);
    // Now — and only now — Finance may act.
    await workflow.financeOpenReview(submission.id, actors.finance);
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.FINANCE_REVIEW);

    // sanity: clinic scope unchanged
    expect(clinic.id).toBeDefined();
  });

  it('comments: send-back requires one, and records SENT_BACK / APPROVED with roleAtTime', async () => {
    // Empty/missing comment on send-back → 400.
    const r = await openWithHeads(1);
    const actors = await fx.driveToStatus(r.submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await expectStatus(workflow.managerSendBack(r.submission.id, actors.manager, '   '), 400);

    // With a comment → one SENT_BACK comment, roleAtTime = CLINIC_MANAGER.
    await workflow.managerSendBack(r.submission.id, actors.manager, 'Numbers look off');
    const sentBack = await prisma.submissionComment.findMany({ where: { submissionId: r.submission.id } });
    expect(sentBack).toHaveLength(1);
    expect(sentBack[0].action).toBe(CommentAction.SENT_BACK);
    expect(sentBack[0].roleAtTime).toBe(UserRole.CLINIC_MANAGER);
    expect(sentBack[0].comment).toBe('Numbers look off');

    // Approve WITH an optional comment → one APPROVED comment.
    const a = await openWithHeads(1);
    const aa = await fx.driveToStatus(a.submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await workflow.managerApprove(a.submission.id, aa.manager, 'Looks good');
    const approved = await prisma.submissionComment.findMany({
      where: { submissionId: a.submission.id, action: CommentAction.APPROVED },
    });
    expect(approved).toHaveLength(1);
    expect(approved[0].roleAtTime).toBe(UserRole.CLINIC_MANAGER);
  });

  it('clinic scope: a manager of clinic A cannot act on clinic B; finance can act anywhere', async () => {
    const b = await openWithHeads(1);
    await fx.driveToStatus(b.submission.id, SubmissionStatus.SUBMITTED);

    const clinicA = await fx.makeClinic();
    const managerA = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinicA.id])).user;
    await expectStatus(workflow.managerOpenReview(b.submission.id, managerA), 403);

    // Finance has org-wide access — drive B to CLINIC_APPROVED then finance opens it.
    const realManagerB = (await fx.makeUser(UserRole.CLINIC_MANAGER, [b.clinic.id])).user;
    await workflow.managerOpenReview(b.submission.id, realManagerB);
    await workflow.managerApprove(b.submission.id, realManagerB);
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    await workflow.financeOpenReview(b.submission.id, finance);
    expect((await reload(b.submission.id)).status).toBe(SubmissionStatus.FINANCE_REVIEW);
  });

  it('stale-status: acting on a submission whose status is not in the action from-set → 409', async () => {
    const { clinic, submission } = await openWithHeads(1);
    // Force a status that MANAGER_OPEN_REVIEW does not accept (from = [SUBMITTED]).
    await prisma.monthlySubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.CLINIC_APPROVED },
    });
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    await expectStatus(workflow.managerOpenReview(submission.id, manager), 409);
  });

  // ── Step 8.3 — unlock with mandatory reason (FR-06) ─────────────────────────

  it('unlock requires a reason, reopens to FINANCE_REVIEW, stores it, audit-logs it; re-approval re-locks', async () => {
    const { submission } = await openWithHeads(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    // No reason → 400.
    await expectStatus(workflow.financeUnlock(submission.id, admin, '   '), 400);

    // With a reason → reopens, clears the lock, stores the reason.
    await runWithRequestContext({ user: { id: admin.id }, ip: '198.51.100.4' }, () =>
      workflow.financeUnlock(submission.id, admin, 'Correcting the rent figure'),
    );
    let s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_REVIEW);
    expect(s.lockedAt).toBeNull();
    expect(s.unlockedReason).toBe('Correcting the rent figure');
    expect(s.unlockedById).toBe(admin.id);

    // Audit row for the unlock.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'UNLOCK' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(admin.id);
    expect(audits[0].ipAddress).toBe('198.51.100.4');
    expect(audits[0].clinicId).toBe(submission.clinicId);

    // Re-approval re-locks.
    await workflow.financeApprove(submission.id, admin);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_APPROVED);
    expect(s.lockedAt).not.toBeNull();
  });

  it('rejects unlocking a submission that is not approved (409) and non-admins (403)', async () => {
    const { clinic, submission } = await openWithHeads(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_REVIEW);
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    // Not yet locked → 409.
    await expectStatus(workflow.financeUnlock(submission.id, admin, 'reason'), 409);

    // A non-admin can never unlock → 403 (role checked before status).
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    await expectStatus(workflow.financeUnlock(submission.id, manager, 'reason'), 403);
  });

  // ── SPOC recall/revoke (back to DRAFT before finance lock) ──────────────────

  // Every recallable state → DRAFT, entries preserved & editable again, exactly
  // one SUBMISSION_RECALLED audit row (actor = SPOC), prior review stamps cleared.
  const RECALLABLE = [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.CLINIC_MANAGER_REVIEW,
    SubmissionStatus.CLINIC_APPROVED,
    SubmissionStatus.FINANCE_REVIEW,
  ];
  it.each(RECALLABLE)('SPOC recalls from %s → DRAFT, entries preserved, one audit row', async (from) => {
    const { submission } = await openWithHeads(2);
    const { spoc } = await fx.driveToStatus(submission.id, from);
    const entriesBefore = await prisma.provisionEntry.count({ where: { submissionId: submission.id } });
    expect(entriesBefore).toBe(2);

    await runWithRequestContext({ user: { id: spoc.id }, ip: '203.0.113.7' }, () =>
      workflow.recall(submission.id, spoc, 'Recalled to fix a data-entry error'),
    );

    const s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.DRAFT);
    // Stale review/approval metadata wiped so the resubmission is fresh.
    expect(s.submittedAt).toBeNull();
    expect(s.reviewStartedAt).toBeNull();
    expect(s.reviewStartedById).toBeNull();
    expect(s.approvedByManagerAt).toBeNull();

    // Entries preserved and the form is editable again for the SPOC.
    expect(await prisma.provisionEntry.count({ where: { submissionId: submission.id } })).toBe(2);
    const detail = await submissions.getDetail(submission.id, spoc);
    expect(detail.canEdit).toBe(true);
    expect(detail.canRecall).toBe(false); // DRAFT is no longer recallable

    // Exactly one audit row, named SUBMISSION_RECALLED, attributed to the SPOC.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: AuditAction.SUBMISSION_RECALLED },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(spoc.id);
    expect(audits[0].clinicId).toBe(submission.clinicId);
    expect(audits[0].oldValue).toEqual({ status: from });
    expect(audits[0].newValue).toEqual({ status: SubmissionStatus.DRAFT });

    // The optional reason landed on the timeline as one RECALLED comment.
    const comments = await prisma.submissionComment.findMany({
      where: { submissionId: submission.id, action: CommentAction.RECALLED },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe('Recalled to fix a data-entry error');
    expect(comments[0].roleAtTime).toBe(UserRole.CLINIC_SPOC);
  });

  it('recall without a reason writes no comment row (and still audits the recall once)', async () => {
    const { submission } = await openWithHeads(1);
    const { spoc } = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);

    await workflow.recall(submission.id, spoc); // no reason
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.DRAFT);
    expect(await prisma.submissionComment.count({ where: { submissionId: submission.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: submission.id, action: AuditAction.SUBMISSION_RECALLED },
      }),
    ).toBe(1);
  });

  it('rejects recall once FINANCE_APPROVED/locked (409)', async () => {
    const { submission } = await openWithHeads(1);
    const { spoc } = await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);
    await expectStatus(workflow.recall(submission.id, spoc), 409);
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.FINANCE_APPROVED);
  });

  it('rejects a non-SPOC role (403) and another clinic’s SPOC (403)', async () => {
    const { clinic, submission } = await openWithHeads(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);

    // Manager of the same clinic cannot recall (role check before state).
    await expectStatus(workflow.recall(submission.id, manager), 403);

    // A SPOC scoped to a different clinic cannot recall this one (scope → 403).
    const otherClinic = await fx.makeClinic();
    const otherSpoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [otherClinic.id])).user;
    await expectStatus(workflow.recall(submission.id, otherSpoc), 403);

    // Untouched by the rejected attempts.
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.SUBMITTED);
    expect(clinic.id).toBeDefined();
  });

  it('recall vs finance-finalize race: exactly one wins, recall loses cleanly (409) if finalized first', async () => {
    // Finalize-then-recall: finance locks it first → the SPOC recall loses (409).
    const a = await openWithHeads(1);
    const actorsA = await fx.driveToStatus(a.submission.id, SubmissionStatus.FINANCE_REVIEW);
    await workflow.financeApprove(a.submission.id, actorsA.finance);
    await expectStatus(workflow.recall(a.submission.id, actorsA.spoc), 409);
    expect((await reload(a.submission.id)).status).toBe(SubmissionStatus.FINANCE_APPROVED);

    // Recall-then-finalize: the SPOC recalls first → finance's approve loses (409).
    const b = await openWithHeads(1);
    const actorsB = await fx.driveToStatus(b.submission.id, SubmissionStatus.FINANCE_REVIEW);
    await workflow.recall(b.submission.id, actorsB.spoc);
    await expectStatus(workflow.financeApprove(b.submission.id, actorsB.finance), 409);
    expect((await reload(b.submission.id)).status).toBe(SubmissionStatus.DRAFT);
  });

  it('after recall the item leaves both review queues and a re-submit re-flows through manager → finance', async () => {
    const { clinic, submission } = await openWithHeads(1);
    const { spoc, manager, finance } = await fx.driveToStatus(
      submission.id,
      SubmissionStatus.FINANCE_REVIEW,
    );

    await workflow.recall(submission.id, spoc);

    // Gone from the manager queue (SUBMITTED/MANAGER_REVIEW) and the finance queue
    // (CLINIC_APPROVED/FINANCE_REVIEW) — both filter by status.
    const managerQueue = await submissions.listQueue(manager, {
      statuses: [SubmissionStatus.SUBMITTED, SubmissionStatus.CLINIC_MANAGER_REVIEW],
    });
    const financeQueue = await submissions.listQueue(finance, {
      statuses: [SubmissionStatus.CLINIC_APPROVED, SubmissionStatus.FINANCE_REVIEW],
    });
    expect(managerQueue.find((q) => q.id === submission.id)).toBeUndefined();
    expect(financeQueue.find((q) => q.id === submission.id)).toBeUndefined();

    // Re-submit re-flows fully through Manager → Finance with fresh stamps.
    await workflow.submit(submission.id, spoc);
    let s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.SUBMITTED);
    expect(s.submittedAt).not.toBeNull(); // stamped fresh on resubmit

    await workflow.managerOpenReview(submission.id, manager);
    await workflow.managerApprove(submission.id, manager);
    await workflow.financeOpenReview(submission.id, finance);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_REVIEW);
    expect(s.reviewStartedById).toBe(finance.id);
    expect(clinic.id).toBeDefined();
  });
});

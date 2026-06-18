import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionCommentsService } from './submission-comments.service';
import { AuditService } from '../audit/audit.service';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

describe('SubmissionCommentsService (Step 5.3 — comment timeline)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let comments: SubmissionCommentsService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        SubmissionCommentsService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    comments = moduleRef.get(SubmissionCommentsService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** A clinic + opened cycle with one mapped head. */
  async function openOne() {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    return { clinic, submission };
  }

  it('builds a chronological timeline with timestamps, commenter, role and action', async () => {
    const { clinic, submission } = await openOne();
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    // Three review actions, each with a comment.
    await workflow.managerSendBack(submission.id, actors.manager, 'A: please revise');
    await workflow.submit(submission.id, actors.spoc); // resubmit, no comment
    await workflow.managerOpenReview(submission.id, actors.manager);
    await workflow.managerApprove(submission.id, actors.manager, 'B: looks good now');
    await workflow.financeOpenReview(submission.id, actors.finance);
    await workflow.financeApprove(submission.id, actors.finance, 'C: approved & locked');

    // Read as a clinic viewer of the same clinic (a "relevant party").
    const viewer = (await fx.makeUser(UserRole.CLINIC_VIEWER, [clinic.id])).user;
    const timeline = await comments.listForSubmission(submission.id, viewer);

    expect(timeline.map((c) => c.comment)).toEqual([
      'A: please revise',
      'B: looks good now',
      'C: approved & locked',
    ]);
    expect(timeline.map((c) => c.action)).toEqual(['SENT_BACK', 'APPROVED', 'APPROVED']);
    expect(timeline.map((c) => c.roleAtTime)).toEqual([
      UserRole.CLINIC_MANAGER,
      UserRole.CLINIC_MANAGER,
      UserRole.FINANCE_ADMIN,
    ]);

    // Timestamps present, ISO, non-decreasing; commenter name surfaced.
    const times = timeline.map((c) => Date.parse(c.createdAt));
    times.forEach((t) => expect(Number.isNaN(t)).toBe(false));
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(times[1]).toBeLessThanOrEqual(times[2]);
    timeline.forEach((c) => expect(c.commentedBy.name).toBeTruthy());
  });

  it('a rejected (comment-less) send-back leaves no comment on the timeline', async () => {
    const { clinic, submission } = await openOne();
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    await expectStatus(workflow.managerSendBack(submission.id, actors.manager, '   '), 400);

    const viewer = (await fx.makeUser(UserRole.CLINIC_VIEWER, [clinic.id])).user;
    const timeline = await comments.listForSubmission(submission.id, viewer);
    expect(timeline).toHaveLength(0);
  });

  it('enforces visibility: other-clinic user 403, finance sees all, missing submission 404', async () => {
    const { clinic, submission } = await openOne();
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await workflow.managerSendBack(submission.id, actors.manager, 'needs work');

    // Manager of a different clinic → 403.
    const otherClinic = await fx.makeClinic();
    const outsider = (await fx.makeUser(UserRole.CLINIC_MANAGER, [otherClinic.id])).user;
    await expectStatus(comments.listForSubmission(submission.id, outsider), 403);

    // Finance manager (org-wide, no clinic assignment) → sees it.
    const financeManager = (await fx.makeUser(UserRole.FINANCE_MANAGER)).user;
    const seen = await comments.listForSubmission(submission.id, financeManager);
    expect(seen).toHaveLength(1);

    // Assigned SPOC of the clinic → also a relevant party.
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    expect(await comments.listForSubmission(submission.id, spoc)).toHaveLength(1);

    // Missing submission → 404.
    await expectStatus(comments.listForSubmission('no-such-submission', financeManager), 404);
  });
});

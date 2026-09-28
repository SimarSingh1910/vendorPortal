import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionsService } from './submissions.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';

const MONTH = '2026-07';

describe('SubmissionsService queue/detail (Step 7.1 — manager review surface)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
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
        AttachmentsService,
        CorpDepartmentScopeService,
        SubmissionsService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    submissions = moduleRef.get(SubmissionsService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function openSubmittedClinic() {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    return { clinic, submission };
  }

  it('listQueue returns only the manager-accessible clinics in the requested statuses', async () => {
    const a = await openSubmittedClinic();
    const b = await openSubmittedClinic();
    const foreign = await openSubmittedClinic(); // not assigned to our manager

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [a.clinic.id, b.clinic.id])).user;
    const queue = await submissions.listQueue(manager, {
      statuses: [SubmissionStatus.SUBMITTED, SubmissionStatus.CLINIC_MANAGER_REVIEW],
    });

    expect(queue.map((q) => q.clinicId).sort()).toEqual([a.clinic.id, b.clinic.id].sort());
    expect(queue.every((q) => q.status === SubmissionStatus.SUBMITTED)).toBe(true);
    expect(queue.find((q) => q.clinicId === foreign.clinic.id)).toBeUndefined();
  });

  it('getDetail exposes who/when after review opens; canEdit is the SPOC inline-edit flag (false for a manager)', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const detail = await submissions.getDetail(submission.id, manager);

    expect(detail.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    // canEdit drives the SPOC inline-edit screen only; a manager overrides via the
    // audited entries endpoint (own clinic, review stage), not this flag.
    expect(detail.canEdit).toBe(false);
    expect(detail.reviewStartedAt).not.toBeNull();

    const reviewer = await prisma.user.findUniqueOrThrow({ where: { id: actors.manager.id } });
    expect(detail.reviewStartedByName).toBe(reviewer.name);
  });

  it('getDetail names the submitter and both approvers even when no comment was left', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const [spoc, manager, finance] = await Promise.all([
      fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]),
      fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id]),
      fx.makeUser(UserRole.FINANCE_ADMIN),
    ]).then((r) => r.map((u) => u.user));
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });

    // Each step as its own request, so the audit row carries the actor — no comments.
    const wf = moduleRef.get(WorkflowService);
    const as = (u: typeof spoc, fn: () => Promise<unknown>) => runWithRequestContext({ user: u }, fn);
    await as(spoc, () => wf.submit(submission.id, spoc));
    await as(manager, () => wf.managerOpenReview(submission.id, manager));
    await as(manager, () => wf.managerApprove(submission.id, manager));
    await as(finance, () => wf.financeOpenReview(submission.id, finance));
    await as(finance, () => wf.financeApprove(submission.id, finance));

    const detail = await submissions.getDetail(submission.id, finance);
    const name = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).name;

    expect(detail.submittedByName).toBe(await name(spoc.id));
    expect(detail.approvedByManagerName).toBe(await name(manager.id));
    expect(detail.approvedByFinanceName).toBe(await name(finance.id));
    expect(detail.approvedByManagerAt).not.toBeNull();
  });

  it('getDetail falls back to the step comment author when the audit row has no actor', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    // No request context → audit rows carry a null actor (like seeded history).
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await moduleRef.get(WorkflowService).managerApprove(submission.id, actors.manager, 'ok');

    const detail = await submissions.getDetail(submission.id, actors.manager);
    const manager = await prisma.user.findUniqueOrThrow({ where: { id: actors.manager.id } });
    expect(detail.approvedByManagerName).toBe(manager.name);
    expect(detail.submittedByName).toBeNull(); // no actor, no comment → stays unknown
  });

  it('getDetail returns the clinic’s Acc. Location Code + Customer Code for the context panel', async () => {
    const clinic = await fx.makeClinic({ accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;

    const detail = await submissions.getDetail(submission.id, spoc);
    expect(detail.clinicAccLocationCode).toBe('LOC-PUN');
    expect(detail.clinicCustomerCode).toBe('CUST-PUN');
  });

  it('an untouched NOT_STARTED cycle follows the current mapping; once entered, it stays frozen (BR-05)', async () => {
    // Cycle opened before any head was mapped — the production September case.
    const clinic = await fx.makeClinic();
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    expect((await submissions.getDetail(submission.id, spoc)).heads).toHaveLength(0);

    const [h1, h2] = [await fx.makeExpenseHead(), await fx.makeExpenseHead()];
    await fx.mapHeads(clinic.id, [h1.id, h2.id]);
    const first = await submissions.getDetail(submission.id, spoc);
    expect(first.heads.map((h) => h.expenseHeadId).sort()).toEqual([h1.id, h2.id].sort());

    // Loading again changes nothing: snapshot ids are stable for an open form.
    const again = await submissions.getDetail(submission.id, spoc);
    expect(again.heads.map((h) => h.snapshotId).sort()).toEqual(first.heads.map((h) => h.snapshotId).sort());

    // Unmapping drops the head while the cycle is still untouched.
    await prisma.clinicExpenseHead.updateMany({ where: { clinicId: clinic.id, expenseHeadId: h2.id }, data: { isActive: false } });
    expect((await submissions.getDetail(submission.id, spoc)).heads.map((h) => h.expenseHeadId)).toEqual([h1.id]);

    // Once a figure is entered the snapshot is frozen again.
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });
    await prisma.clinicExpenseHead.updateMany({ where: { clinicId: clinic.id, expenseHeadId: h2.id }, data: { isActive: true } });
    expect((await submissions.getDetail(submission.id, spoc)).heads.map((h) => h.expenseHeadId)).toEqual([h1.id]);
  });

  it('a DRAFT with nothing entered (an empty save) still follows the mapping', async () => {
    const clinic = await fx.makeClinic();
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    await prisma.monthlySubmission.update({ where: { id: submission.id }, data: { status: SubmissionStatus.DRAFT } });
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;

    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    expect((await submissions.getDetail(submission.id, spoc)).heads.map((h) => h.expenseHeadId)).toEqual([head.id]);
  });

  it('parallel loads right after a remap all succeed and leave exactly one snapshot per head', async () => {
    const clinic = await fx.makeClinic();
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const heads = [];
    for (let i = 0; i < 6; i += 1) heads.push(await fx.makeExpenseHead());
    await fx.mapHeads(clinic.id, heads.map((h) => h.id));

    const loads = await Promise.all(Array.from({ length: 12 }, () => submissions.getDetail(submission.id, spoc)));
    // Every racing load returns the synced list, not the one it read before the winner's resync.
    expect(loads.map((d) => d.heads.length)).toEqual(Array(12).fill(6));
    expect(await prisma.submissionExpenseHeadSnapshot.count({ where: { submissionId: submission.id } })).toBe(6);
    expect((await submissions.getDetail(submission.id, spoc)).heads).toHaveLength(6);
  });
});

import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionsService } from './submissions.service';
import { AuditService } from '../audit/audit.service';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

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

  it('getDetail exposes who/when after review opens and stays read-only for a manager', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const detail = await submissions.getDetail(submission.id, manager);

    expect(detail.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    expect(detail.canEdit).toBe(false); // managers never edit values
    expect(detail.reviewStartedAt).not.toBeNull();

    const reviewer = await prisma.user.findUniqueOrThrow({ where: { id: actors.manager.id } });
    expect(detail.reviewStartedByName).toBe(reviewer.name);
  });
});

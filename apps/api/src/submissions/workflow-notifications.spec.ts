import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { NotificationDispatchService, NotificationType } from '../notifications/notification-dispatch.service';
import { EmailService } from '../notifications/email.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

/**
 * Step 10.3 wiring: drive real transitions through the WorkflowService + the real
 * NotificationDispatchService (no parallel path) and assert the right users are
 * notified at each transition — proving the engine actually invokes dispatch.
 */
describe('Workflow → notification dispatch wiring (Step 10.3)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        AuditService,
        CycleService,
        WorkflowService,
        NotificationService,
        NotificationEventsService,
        NotificationDispatchService,
        { provide: EmailService, useValue: { send: jest.fn(async () => undefined) } },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** Emails of users who received a notification of `type`. */
  async function notified(type: string): Promise<string[]> {
    const rows = await prisma.notification.findMany({
      where: { type },
      include: { user: { select: { email: true } } },
    });
    return rows.map((r) => r.user.email).sort();
  }

  it('notifies the right actor on cycle-open, submit, approve, and finance-approve', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    // Cycle open (Trigger 1) → SPOC.
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-07');
    expect(await notified(NotificationType.CYCLE_OPENED)).toEqual([spoc.email]);

    // Submit (Trigger 3) → Manager.
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });
    await workflow.submit(submission.id, spoc);
    expect(await notified(NotificationType.SUBMISSION_SUBMITTED)).toEqual([manager.email]);

    // Manager approve (Trigger 4) → Finance Admin.
    await workflow.managerOpenReview(submission.id, manager);
    await workflow.managerApprove(submission.id, manager);
    expect(await notified(NotificationType.MANAGER_APPROVED)).toEqual([admin.email]);

    // Finance approve (Trigger 6) → SPOC + Manager.
    await workflow.financeOpenReview(submission.id, admin);
    await workflow.financeApprove(submission.id, admin);
    expect(await notified(NotificationType.FINANCE_APPROVED)).toEqual(
      [spoc.email, manager.email].sort(),
    );
  });

  it('carries the comment to the SPOC on a manager send-back (Trigger 5)', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;

    // Drive to CLINIC_MANAGER_REVIEW with these exact actors (not the fixture's
    // auto-actors, so the send-back has a single, known SPOC recipient).
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-08');
    await fx.valueAllHeads(submission.id, { enteredById: spoc.id });
    await workflow.submit(submission.id, spoc);
    await workflow.managerOpenReview(submission.id, manager);

    await workflow.managerSendBack(submission.id, manager, 'Rent figure looks wrong');

    const rows = await prisma.notification.findMany({
      where: { type: NotificationType.MANAGER_SENT_BACK },
      include: { user: { select: { email: true } } },
    });
    expect(rows.map((r) => r.user.email)).toEqual([spoc.email]);
    expect(rows[0].message).toContain('Rent figure looks wrong');
  });
});

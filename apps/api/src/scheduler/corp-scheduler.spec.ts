import { Test, type TestingModule } from '@nestjs/testing';
import { CorpSubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { CorpNotificationDispatchService, CorpNotificationType } from '../corp-submissions/corp-notification-dispatch.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { EmailService } from '../notifications/email.service';
import { CycleService } from '../submissions/cycle.service';
import { SchedulerService } from './scheduler.service';
import { resetDb } from '../../test/reset';

/**
 * Step C5.2 — the scheduler also auto-opens corporate department cycles on the
 * notify date and reminds laggard departments before cutoff, reusing the SAME
 * idempotent scheduler + per-cycle NotificationConfig. Clinic behaviour is
 * unchanged (this test provides no clinics, so only the corporate path fires).
 */
describe('SchedulerService — corporate cycles (Step C5.2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: SchedulerService;

  let seq = 0;
  const nextEmail = () => `cs${(seq += 1)}@t.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        ClinicExpenseHeadsService,
        CycleService,
        CorpExpenseHeadsService,
        CorpCycleService,
        NotificationService,
        NotificationEventsService,
        NotificationDispatchService,
        CorpNotificationDispatchService,
        SchedulerService,
        { provide: EmailService, useValue: { send: jest.fn(async () => undefined) } },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    scheduler = moduleRef.get(SchedulerService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const makeDept = (opts: { active?: boolean; name?: string } = {}) =>
    prisma.corpDepartment.create({
      data: { name: opts.name ?? 'Dept', isActive: opts.active ?? true },
    });

  const makeHead = (departmentId: string) =>
    prisma.corpExpenseHead.create({ data: { departmentId, name: nextEmail(), isActive: true } });

  const makeSpoc = (departmentId: string) =>
    prisma.user.create({
      data: {
        name: 'Spoc',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.DEPT_SPOC,
        departmentAssignments: { create: [{ departmentId }] },
      },
    });

  const makeAdmin = () =>
    prisma.user.create({
      data: {
        name: 'Admin',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.FINANCE_ADMIN,
      },
    });

  const config = (month: string) =>
    prisma.notificationConfig.create({
      data: {
        month,
        monthStartNotifyDate: new Date(`${month}-01T02:00:00Z`),
        cutoffDate: new Date(`${month}-20T02:00:00Z`),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });

  it('opens every ACTIVE department for the month and notifies their SPOCs', async () => {
    const a = await makeDept({ name: 'A' });
    const b = await makeDept({ name: 'B' });
    const inactive = await makeDept({ name: 'Inactive', active: false });
    await makeHead(a.id);
    await makeHead(b.id);
    const spocA = await makeSpoc(a.id);
    const spocB = await makeSpoc(b.id);
    await makeSpoc(inactive.id); // decoy: inactive dept never opens

    const result = await scheduler.openCorpCycleForMonth('2026-07');

    expect(result).toMatchObject({ activeDepartments: 2, created: 2, alreadyOpen: 0 });
    expect(await prisma.corpMonthlySubmission.count()).toBe(2);
    const opened = await prisma.notification.findMany({
      where: { type: CorpNotificationType.CORP_CYCLE_OPENED },
      include: { user: { select: { email: true } } },
    });
    expect(opened.map((r) => r.user.email).sort()).toEqual([spocA.email, spocB.email].sort());
  });

  it('re-running the open makes no duplicate cycles or notifications', async () => {
    const a = await makeDept();
    await makeHead(a.id);
    await makeSpoc(a.id);

    await scheduler.openCorpCycleForMonth('2026-07');
    const second = await scheduler.openCorpCycleForMonth('2026-07');

    expect(second).toMatchObject({ created: 0, alreadyOpen: 1 });
    expect(await prisma.corpMonthlySubmission.count()).toBe(1);
    expect(
      await prisma.notification.count({ where: { type: CorpNotificationType.CORP_CYCLE_OPENED } }),
    ).toBe(1);
  });

  it('flags a zero-active-head department to Finance Admins at open time', async () => {
    const a = await makeDept();
    await makeSpoc(a.id); // SPOC still notified of the (empty) open
    const admin = await makeAdmin();

    await scheduler.openCorpCycleForMonth('2026-07');

    const flags = await prisma.notification.findMany({
      where: { type: CorpNotificationType.CORP_DEPT_NO_HEADS },
      include: { user: { select: { email: true } } },
    });
    expect(flags.map((r) => r.user.email)).toEqual([admin.email]);
  });

  it('reminders go only to laggard (NOT_STARTED/DRAFT) departments’ SPOCs', async () => {
    const laggard = await makeDept({ name: 'Laggard' });
    const ahead = await makeDept({ name: 'Ahead' });
    await makeHead(laggard.id);
    await makeHead(ahead.id);
    const lagSpoc = await makeSpoc(laggard.id);
    await makeSpoc(ahead.id);
    await config('2026-07');
    await scheduler.openCorpCycleForMonth('2026-07'); // both NOT_STARTED

    // Push the "ahead" department out of laggard status.
    const aheadSub = await prisma.corpMonthlySubmission.findFirstOrThrow({
      where: { departmentId: ahead.id },
    });
    await prisma.corpMonthlySubmission.update({
      where: { id: aheadSub.id },
      data: { status: CorpSubmissionStatus.SUBMITTED },
    });

    const count = await scheduler.sendCorpReminders('2026-07');

    expect(count).toBe(1); // only the laggard department
    const reminded = await prisma.notification.findMany({
      where: { type: CorpNotificationType.CORP_PRE_CUTOFF_REMINDER },
      include: { user: { select: { email: true } } },
    });
    expect(reminded.map((r) => r.user.email)).toEqual([lagSpoc.email]);
  });

  it('date-gates via runDailyJobs: opens on notify day, reminds on cutoff − days (IST)', async () => {
    const a = await makeDept();
    await makeHead(a.id);
    await makeSpoc(a.id);
    await config('2026-07'); // notify 2026-07-01 IST; reminder 2026-07-17 IST

    // Neither notify nor reminder day → nothing.
    await scheduler.runDailyJobs(new Date('2026-07-05T03:00:00Z'));
    expect(await prisma.corpMonthlySubmission.count()).toBe(0);

    // Notify day (IST) → opens the corporate cycle.
    await scheduler.runDailyJobs(new Date('2026-07-01T03:00:00Z'));
    expect(await prisma.corpMonthlySubmission.count()).toBe(1);
    expect(
      await prisma.notification.count({ where: { type: CorpNotificationType.CORP_CYCLE_OPENED } }),
    ).toBe(1);

    // Reminder day (IST 2026-07-17) → reminds the still-NOT_STARTED department.
    await scheduler.runDailyJobs(new Date('2026-07-17T04:00:00Z'));
    expect(
      await prisma.notification.count({
        where: { type: CorpNotificationType.CORP_PRE_CUTOFF_REMINDER },
      }),
    ).toBe(1);
  });
});

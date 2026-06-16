import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { NotificationDispatchService, NotificationType } from '../notifications/notification-dispatch.service';
import { EmailService } from '../notifications/email.service';
import { CycleService } from '../submissions/cycle.service';
import { SchedulerService } from './scheduler.service';
import { resetDb } from '../../test/reset';

/**
 * Step 10.4 — the cycle scheduler. Auto-open all active clinics on the notify
 * date, remind laggards the configured number of days before cutoff, flag
 * zero-mapped-head clinics, and stay idempotent on re-run. Date-gating is tested
 * deterministically by passing `now` into runDailyJobs.
 */
describe('SchedulerService (Step 10.4)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: SchedulerService;

  let seq = 0;
  const nextEmail = () => `s${(seq += 1)}@t.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        ClinicExpenseHeadsService,
        CycleService,
        NotificationService,
        NotificationEventsService,
        NotificationDispatchService,
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

  async function makeClinic(opts: { active?: boolean; name?: string } = {}) {
    return prisma.clinic.create({
      data: {
        name: opts.name ?? 'Clinic',
        location: 'L',
        corporateClient: 'C',
        isActive: opts.active ?? true,
      },
    });
  }

  async function makeSpoc(clinicId: string) {
    return prisma.user.create({
      data: {
        name: 'Spoc',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.CLINIC_SPOC,
        assignments: { create: [{ clinicId }] },
      },
    });
  }

  async function mapHead(clinicId: string) {
    const head = await prisma.expenseHead.create({
      data: { name: nextEmail(), category: 'Cat', isActive: true },
    });
    await prisma.clinicExpenseHead.create({
      data: { clinicId, expenseHeadId: head.id, isActive: true },
    });
  }

  it('opens every ACTIVE clinic for the month and notifies their SPOCs', async () => {
    const a = await makeClinic({ name: 'A' });
    const b = await makeClinic({ name: 'B' });
    const inactive = await makeClinic({ name: 'Inactive', active: false });
    await mapHead(a.id);
    await mapHead(b.id);
    const spocA = await makeSpoc(a.id);
    const spocB = await makeSpoc(b.id);
    await makeSpoc(inactive.id); // decoy: inactive clinic never opens

    const result = await scheduler.openCycleForMonth('2026-07');

    expect(result).toMatchObject({ activeClinics: 2, created: 2, alreadyOpen: 0 });
    // No submission for the inactive clinic.
    expect(await prisma.monthlySubmission.count()).toBe(2);
    const opened = await prisma.notification.findMany({
      where: { type: NotificationType.CYCLE_OPENED },
      include: { user: { select: { email: true } } },
    });
    expect(opened.map((r) => r.user.email).sort()).toEqual([spocA.email, spocB.email].sort());
  });

  it('re-running the open makes no duplicate cycles or notifications', async () => {
    const a = await makeClinic();
    await mapHead(a.id);
    await makeSpoc(a.id);

    await scheduler.openCycleForMonth('2026-07');
    const second = await scheduler.openCycleForMonth('2026-07');

    expect(second).toMatchObject({ created: 0, alreadyOpen: 1 });
    expect(await prisma.monthlySubmission.count()).toBe(1);
    // Exactly one cycle-open notification across both runs.
    expect(
      await prisma.notification.count({ where: { type: NotificationType.CYCLE_OPENED } }),
    ).toBe(1);
  });

  it('flags a zero-mapped-head clinic to Finance Admins at open time', async () => {
    const a = await makeClinic();
    await makeSpoc(a.id); // SPOC still notified of the (empty) open
    const admin = await prisma.user.create({
      data: {
        name: 'Admin',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.FINANCE_ADMIN,
      },
    });

    await scheduler.openCycleForMonth('2026-07');

    const flags = await prisma.notification.findMany({
      where: { type: NotificationType.CLINIC_NO_HEADS },
      include: { user: { select: { email: true } } },
    });
    expect(flags.map((r) => r.user.email)).toEqual([admin.email]);
  });

  it('reminders go only to laggard (NOT_STARTED/DRAFT) clinics SPOCs + Managers', async () => {
    const laggard = await makeClinic({ name: 'Laggard' });
    const ahead = await makeClinic({ name: 'Ahead' });
    await mapHead(laggard.id);
    await mapHead(ahead.id);
    const lagSpoc = await makeSpoc(laggard.id);
    const lagMgr = await prisma.user.create({
      data: {
        name: 'Mgr',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.CLINIC_MANAGER,
        assignments: { create: [{ clinicId: laggard.id }] },
      },
    });
    await makeSpoc(ahead.id);

    await prisma.notificationConfig.create({
      data: {
        month: '2026-07',
        monthStartNotifyDate: new Date('2026-07-01T02:30:00Z'),
        cutoffDate: new Date('2026-07-20T02:30:00Z'),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });
    await scheduler.openCycleForMonth('2026-07'); // both NOT_STARTED

    // Push the "ahead" clinic out of laggard status.
    const aheadSub = await prisma.monthlySubmission.findFirstOrThrow({
      where: { clinicId: ahead.id },
    });
    await prisma.monthlySubmission.update({
      where: { id: aheadSub.id },
      data: { status: SubmissionStatus.SUBMITTED },
    });

    const count = await scheduler.sendReminders('2026-07');

    expect(count).toBe(1); // only the laggard clinic
    const reminded = await prisma.notification.findMany({
      where: { type: NotificationType.PRE_CUTOFF_REMINDER },
      include: { user: { select: { email: true } } },
    });
    expect(reminded.map((r) => r.user.email).sort()).toEqual([lagSpoc.email, lagMgr.email].sort());
  });

  it('date-gates: opens on the notify day, reminds on cutoff − preCutoffReminderDays (IST)', async () => {
    const a = await makeClinic();
    await mapHead(a.id);
    await makeSpoc(a.id);
    await prisma.notificationConfig.create({
      data: {
        month: '2026-07',
        // 2026-07-01 07:30 IST (= 02:00 UTC).
        monthStartNotifyDate: new Date('2026-07-01T02:00:00Z'),
        // cutoff 2026-07-20 IST; reminder 3 days before → 2026-07-17 IST.
        cutoffDate: new Date('2026-07-20T02:00:00Z'),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });

    // A day that is neither notify nor reminder day → nothing happens.
    await scheduler.runDailyJobs(new Date('2026-07-05T03:00:00Z'));
    expect(await prisma.monthlySubmission.count()).toBe(0);

    // Notify day (IST) → opens.
    await scheduler.runDailyJobs(new Date('2026-07-01T03:00:00Z'));
    expect(await prisma.monthlySubmission.count()).toBe(1);
    expect(
      await prisma.notification.count({ where: { type: NotificationType.CYCLE_OPENED } }),
    ).toBe(1);

    // Reminder day (IST 2026-07-17) → reminds the still-NOT_STARTED clinic.
    await scheduler.runDailyJobs(new Date('2026-07-17T04:00:00Z'));
    expect(
      await prisma.notification.count({ where: { type: NotificationType.PRE_CUTOFF_REMINDER } }),
    ).toBe(1);
  });
});

import { Test, type TestingModule } from '@nestjs/testing';
import { Portal } from '@prisma/client';
import { PortalTab, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CycleService } from '../submissions/cycle.service';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { CorpNotificationDispatchService } from '../corp-submissions/corp-notification-dispatch.service';
import { EmailService } from './email.service';
import { NotificationConfigService } from './notification-config.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { resetDb } from '../../test/reset';

/**
 * Per-portal NotificationConfig split. Clinic and Corporate each keep their OWN
 * config for a month (independent cutoff/reminder/variance); the clinic
 * scheduler/notifier reads the CLINIC row and the corporate one reads the
 * CORPORATE row. The service defaults to CLINIC so the original clinic call sites
 * (and their tests) are unaffected.
 */
describe('NotificationConfig — per-portal split', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let configSvc: NotificationConfigService;
  let scheduler: SchedulerService;
  let clinicDispatch: NotificationDispatchService;
  let corpDispatch: CorpNotificationDispatchService;

  let seq = 0;
  const nextEmail = () => `np${(seq += 1)}@t.local`;
  const MONTH = '2026-09';
  const CLINIC_CUTOFF = new Date('2026-09-10T02:00:00Z');
  const CORP_CUTOFF = new Date('2026-09-25T02:00:00Z');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        NotificationConfigService,
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
    configSvc = moduleRef.get(NotificationConfigService);
    scheduler = moduleRef.get(SchedulerService);
    clinicDispatch = moduleRef.get(NotificationDispatchService);
    corpDispatch = moduleRef.get(CorpNotificationDispatchService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** Both portals' config for the SAME month, with distinct cutoff dates. */
  async function seedBothConfigs() {
    await prisma.notificationConfig.create({
      data: {
        portal: Portal.CLINIC,
        month: MONTH,
        monthStartNotifyDate: new Date('2026-09-01T02:00:00Z'),
        cutoffDate: CLINIC_CUTOFF,
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });
    await prisma.notificationConfig.create({
      data: {
        portal: Portal.CORPORATE,
        month: MONTH,
        monthStartNotifyDate: new Date('2026-09-01T02:00:00Z'),
        cutoffDate: CORP_CUTOFF,
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '20.00',
      },
    });
  }

  it('keeps clinic and corporate config independent for the same month (and defaults to CLINIC)', async () => {
    await seedBothConfigs();

    // Two rows coexist for the one month — one per portal.
    expect(await prisma.notificationConfig.count({ where: { month: MONTH } })).toBe(2);

    // Reads are portal-scoped; the default (no portal) resolves to CLINIC.
    expect((await configSvc.get(MONTH)).varianceThresholdPercent).toBe('10.00');
    expect((await configSvc.get(MONTH, Portal.CLINIC)).varianceThresholdPercent).toBe('10.00');
    expect((await configSvc.get(MONTH, Portal.CORPORATE)).varianceThresholdPercent).toBe('20.00');

    const clinicList = await configSvc.list(Portal.CLINIC);
    expect(clinicList.every((c) => c.portal === PortalTab.CLINIC)).toBe(true);
    const corpList = await configSvc.list(Portal.CORPORATE);
    expect(corpList.every((c) => c.portal === PortalTab.CORPORATE)).toBe(true);
  });

  it('clinic reminders use the CLINIC cutoff; corporate reminders use the CORPORATE cutoff', async () => {
    await seedBothConfigs();

    // A clinic laggard (NOT_STARTED) for the month.
    const clinic = await prisma.clinic.create({
      data: { name: 'C', location: 'L', corporateClient: 'X', isActive: true },
    });
    await prisma.user.create({
      data: {
        name: 'CSpoc',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.CLINIC_SPOC,
        assignments: { create: [{ clinicId: clinic.id }] },
      },
    });
    await scheduler.openCycleForMonth(MONTH);

    // A corporate laggard (NOT_STARTED) for the month.
    const dept = await prisma.corpDepartment.create({ data: { name: 'D', isActive: true } });
    await prisma.corpExpenseHead.create({ data: { departmentId: dept.id, name: 'H', isActive: true } });
    await prisma.user.create({
      data: {
        name: 'DSpoc',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role: UserRole.DEPT_SPOC,
        departmentAssignments: { create: [{ departmentId: dept.id }] },
      },
    });
    await scheduler.openCorpCycleForMonth(MONTH);

    const clinicSpy = jest.spyOn(clinicDispatch, 'preCutoffReminder');
    const corpSpy = jest.spyOn(corpDispatch, 'preCutoffReminder');

    await scheduler.sendReminders(MONTH);
    await scheduler.sendCorpReminders(MONTH);

    // Each notifier received ITS OWN portal's cutoff date — proof of the split.
    expect(clinicSpy).toHaveBeenCalled();
    expect(clinicSpy.mock.calls[0][1]).toEqual(CLINIC_CUTOFF);
    expect(corpSpy).toHaveBeenCalled();
    expect(corpSpy.mock.calls[0][1]).toEqual(CORP_CUTOFF);

    clinicSpy.mockRestore();
    corpSpy.mockRestore();
  });
});

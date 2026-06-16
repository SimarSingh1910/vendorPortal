import { Test, type TestingModule } from '@nestjs/testing';
import { AuditAction, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { NotificationConfigService } from './notification-config.service';
import { resetDb } from '../../test/reset';

const MONTH = '2026-08';

describe('NotificationConfigService (Step 10.1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: NotificationConfigService;
  let adminId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, NotificationConfigService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(NotificationConfigService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'a@t.local', passwordHash: 'x'.repeat(60), role: UserRole.FINANCE_ADMIN },
    });
    adminId = admin.id;
  });

  const sampleDto = {
    monthStartNotifyDate: '2026-08-01T03:30:00.000Z',
    cutoffDate: '2026-08-20T18:29:59.000Z',
    preCutoffReminderDays: 3,
    varianceThresholdPercent: 10.5,
  };

  it('creates then updates the config, auditing each once with the right action', async () => {
    const created = await runWithRequestContext({ user: { id: adminId }, ip: '10.0.0.9' }, () =>
      service.upsert(MONTH, sampleDto),
    );
    expect(created.month).toBe(MONTH);
    expect(created.preCutoffReminderDays).toBe(3);
    expect(created.varianceThresholdPercent).toBe('10.50');

    const createRows = await prisma.auditLog.findMany({
      where: { action: AuditAction.NOTIFICATION_CONFIG_CREATE },
    });
    expect(createRows).toHaveLength(1);
    expect(createRows[0].performedById).toBe(adminId);

    // Update (same month) → one UPDATE row, values changed.
    const updated = await runWithRequestContext({ user: { id: adminId }, ip: '10.0.0.9' }, () =>
      service.upsert(MONTH, { ...sampleDto, preCutoffReminderDays: 5 }),
    );
    expect(updated.preCutoffReminderDays).toBe(5);

    expect(await prisma.auditLog.count({ where: { action: AuditAction.NOTIFICATION_CONFIG_UPDATE } })).toBe(1);
    // Still exactly one config row for the month.
    expect(await prisma.notificationConfig.count({ where: { month: MONTH } })).toBe(1);
  });

  it('reads back the config (get + list) and rejects a bad month', async () => {
    await runWithRequestContext({ user: { id: adminId }, ip: '10.0.0.9' }, () =>
      service.upsert(MONTH, sampleDto),
    );

    const got = await service.get(MONTH);
    expect(got.month).toBe(MONTH);

    const all = await service.list();
    expect(all.map((c) => c.month)).toContain(MONTH);

    await expect(service.get('2026-13')).rejects.toThrow();
    await expect(service.upsert('not-a-month', sampleDto)).rejects.toThrow();
  });
});

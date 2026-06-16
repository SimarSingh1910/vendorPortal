import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole, type NotificationView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { EmailService } from './email.service';
import { resetDb } from '../../test/reset';

describe('NotificationService channels (Step 10.2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: NotificationService;
  let events: NotificationEventsService;
  const emailSend = jest.fn(async () => undefined);
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        NotificationService,
        NotificationEventsService,
        { provide: EmailService, useValue: { send: emailSend } },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(NotificationService);
    events = moduleRef.get(NotificationEventsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    emailSend.mockClear();
    userEmail = 'spoc@t.local';
    const user = await prisma.user.create({
      data: { name: 'Spoc', email: userEmail, passwordHash: 'x'.repeat(60), role: UserRole.CLINIC_SPOC },
    });
    userId = user.id;
  });

  it('delivers in real time, increments the unread badge, marks read, and sends an email', async () => {
    // Subscribe to the user's live stream BEFORE creating.
    const received: NotificationView[] = [];
    const sub = events.subscribe(userId).subscribe((n) => received.push(n));

    const created = await service.create({
      userId,
      type: 'TEST',
      message: 'hello there',
      emailSubject: 'Test subject',
    });

    // Real-time in-app delivery.
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(created.id);

    // Badge / unread count.
    expect(await service.unreadCount(userId)).toBe(1);

    // Corresponding email sent to the user.
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledWith(userEmail, 'Test subject', 'hello there');

    // Mark read clears the badge.
    await service.markRead(userId, created.id);
    expect(await service.unreadCount(userId)).toBe(0);

    sub.unsubscribe();
  });

  it('mark-as-read is scoped to the owner; mark-all clears everything', async () => {
    const other = await prisma.user.create({
      data: { name: 'Other', email: 'o@t.local', passwordHash: 'x'.repeat(60), role: UserRole.CLINIC_SPOC },
    });
    const mine = await service.create({ userId, type: 'A', message: 'm1' });
    await service.create({ userId, type: 'A', message: 'm2' });

    // Another user cannot mark my notification read.
    await service.markRead(other.id, mine.id);
    expect(await service.unreadCount(userId)).toBe(2);

    // No email when no subject is given (in-app only).
    expect(emailSend).not.toHaveBeenCalled();

    await service.markAllRead(userId);
    expect(await service.unreadCount(userId)).toBe(0);
    expect((await service.listForUser(userId)).every((n) => n.isRead)).toBe(true);
  });
});

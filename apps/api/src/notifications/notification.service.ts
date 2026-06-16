import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import type { NotificationView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEventsService } from './notification-events.service';
import { EmailService } from './email.service';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  message: string;
  submissionId?: string | null;
  /** Email subject; if omitted no email is sent (in-app only). */
  emailSubject?: string;
}

function toView(n: Notification): NotificationView {
  return {
    id: n.id,
    type: n.type,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    submissionId: n.submissionId,
  };
}

/**
 * Notification channels (Step 10.2): persists a Notification row, pushes it to
 * the user's in-app SSE stream in real time, and (when an email subject is
 * given) sends a matching email via SES. The dispatch hooks left in the workflow
 * engine (Phase 5/6/7/8) will call this once the scheduler/triggers are wired.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationEventsService,
    private readonly email: EmailService,
  ) {}

  async create(input: CreateNotificationInput): Promise<NotificationView> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        message: input.message,
        submissionId: input.submissionId ?? null,
      },
    });
    const view = toView(row);

    // In-app, real time.
    this.events.publish(input.userId, view);

    // Email (best-effort) when a subject is supplied.
    if (input.emailSubject) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });
      if (user) {
        void this.email.send(user.email, input.emailSubject, input.message);
      }
    }

    return view;
  }

  listForUser(userId: string, limit = 50): Promise<NotificationView[]> {
    return this.prisma.notification
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit })
      .then((rows) => rows.map(toView));
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  /** Mark one notification read (scoped to the owner). */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}

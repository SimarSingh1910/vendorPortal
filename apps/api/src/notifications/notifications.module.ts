import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationConfigService } from './notification-config.service';
import { NotificationConfigController } from './notification-config.controller';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EmailService } from './email.service';
import { NotificationController } from './notification.controller';

/**
 * Notifications (Phase 10). Step 10.1: per-cycle config. Step 10.2: in-app (SSE)
 * + email (SES) channels, the notification tray API, and a live stream. Step 10.3:
 * NotificationDispatchService — the single event→recipient path wired into the
 * workflow engine, cycle opener, and scheduler. NotificationConfigService,
 * NotificationService and NotificationDispatchService are exported for them.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationConfigController, NotificationController],
  providers: [
    NotificationConfigService,
    NotificationService,
    NotificationEventsService,
    NotificationDispatchService,
    EmailService,
  ],
  exports: [NotificationConfigService, NotificationService, NotificationDispatchService],
})
export class NotificationsModule {}

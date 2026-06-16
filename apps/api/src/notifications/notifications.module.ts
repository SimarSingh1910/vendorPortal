import { Module } from '@nestjs/common';
import { NotificationConfigService } from './notification-config.service';
import { NotificationConfigController } from './notification-config.controller';

/**
 * Notifications (Phase 10). Step 10.1 ships per-cycle notification config; the
 * in-app (SSE) + email channels and the notification tray arrive in 10.2.
 */
@Module({
  controllers: [NotificationConfigController],
  providers: [NotificationConfigService],
  exports: [NotificationConfigService],
})
export class NotificationsModule {}

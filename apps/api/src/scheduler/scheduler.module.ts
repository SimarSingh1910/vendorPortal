import { Module } from '@nestjs/common';
import { SubmissionsModule } from '../submissions/submissions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulerService } from './scheduler.service';
import { CycleAdminController } from './cycle-admin.controller';

/**
 * Cycle scheduler (Step 10.4): the daily IST cron (auto-open + reminders) plus
 * the admin "open now / re-run" endpoint. Reuses CycleService (cycle opening)
 * and NotificationDispatchService (reminders) from their owning modules.
 */
@Module({
  imports: [SubmissionsModule, NotificationsModule],
  controllers: [CycleAdminController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}

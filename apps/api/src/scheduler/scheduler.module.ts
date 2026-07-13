import { Module } from '@nestjs/common';
import { SubmissionsModule } from '../submissions/submissions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CorpSubmissionsModule } from '../corp-submissions/corp-submissions.module';
import { SchedulerService } from './scheduler.service';
import { CycleAdminController } from './cycle-admin.controller';
import { CorpCycleAdminController } from './corp-cycle-admin.controller';

/**
 * Cycle scheduler (Step 10.4 + C5.2): the daily IST cron (auto-open + reminders,
 * now for clinics AND corporate departments) plus the admin "open now / re-run"
 * endpoints. Reuses CycleService / CorpCycleService (cycle opening) and the
 * notification dispatch services (reminders) from their owning modules.
 */
@Module({
  imports: [SubmissionsModule, NotificationsModule, CorpSubmissionsModule],
  controllers: [CycleAdminController, CorpCycleAdminController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}

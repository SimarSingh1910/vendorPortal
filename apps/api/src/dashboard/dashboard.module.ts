import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

/**
 * Dashboards & analytics (FR-07, Phase 11). ClinicScopeService (CommonModule)
 * and PrismaService (PrismaModule) are global, so no imports are needed.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}

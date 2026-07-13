import { Module } from '@nestjs/common';
import { CorpSubmissionsModule } from '../corp-submissions/corp-submissions.module';
import { CorpDashboardService } from './corp-dashboard.service';
import { CorpDashboardController } from './corp-dashboard.controller';

/**
 * Corporate dashboards & analytics (Step C4.1). Imports CorpSubmissionsModule for
 * CorpDepartmentScopeService (department scoping); PrismaService is global. A
 * read-only presentation layer over the corporate provision data.
 */
@Module({
  imports: [CorpSubmissionsModule],
  controllers: [CorpDashboardController],
  providers: [CorpDashboardService],
  exports: [CorpDashboardService],
})
export class CorpDashboardModule {}

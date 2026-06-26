import { Body, Controller, Param, Post } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { SchedulerService } from './scheduler.service';
import { OpenCorpCycleDto } from './dto/open-corp-cycle.dto';

/**
 * Corporate admin cycle controls (Step C5.2). Finance Admin only (RolesGuard →
 * 403 otherwise) and Corporate tab (TabGuard keeps clinic-only roles out). The
 * manual "open now / re-run" lets the corporate SPOC → Finance flow be exercised
 * before/independent of the cron. Idempotent: re-opening an already-open cycle
 * creates nothing new and re-notifies no one (notifications fire on first
 * creation inside CorpCycleService).
 */
@Controller('corp/cycles')
@Roles(UserRole.FINANCE_ADMIN)
@RequireTab(PortalTab.CORPORATE)
export class CorpCycleAdminController {
  constructor(
    private readonly corpCycle: CorpCycleService,
    private readonly scheduler: SchedulerService,
  ) {}

  /**
   * Open (or re-run) the corporate cycle for `:month` (YYYY-MM). With a
   * `departmentId` in the body, opens just that department; without it, opens
   * every active department.
   */
  @Post(':month/open')
  async open(@Param('month') month: string, @Body() dto: OpenCorpCycleDto) {
    if (dto.departmentId) {
      const { submission, created } = await this.corpCycle.openDepartmentCycle(
        dto.departmentId,
        month,
      );
      return {
        month,
        departmentId: dto.departmentId,
        created,
        submissionId: submission.id,
        status: submission.status,
      };
    }
    return this.scheduler.openCorpCycleForMonth(month);
  }
}

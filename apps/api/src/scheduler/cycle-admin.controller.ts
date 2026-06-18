import { Body, Controller, Param, Post } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CycleService } from '../submissions/cycle.service';
import { SchedulerService } from './scheduler.service';
import { OpenCycleDto } from './dto/open-cycle.dto';

/**
 * Admin cycle controls (Step 10.4). Finance Admin or Manager (global RolesGuard
 * → 403 otherwise). The manual "open now / re-run" endpoint is what lets the full
 * SPOC → Manager → Finance flow be exercised in the browser before or independent
 * of the cron. Idempotent: opening an already-open cycle creates nothing new and
 * re-notifies no one.
 */
@Controller('admin/cycles')
@Roles(UserRole.FINANCE_ADMIN)
export class CycleAdminController {
  constructor(
    private readonly cycle: CycleService,
    private readonly scheduler: SchedulerService,
  ) {}

  /**
   * Open (or re-run) a cycle on demand for `:month` (YYYY-MM). With a `clinicId`
   * in the body, opens just that clinic; without it, opens every active clinic.
   */
  @Post(':month/open')
  async open(@Param('month') month: string, @Body() dto: OpenCycleDto) {
    if (dto.clinicId) {
      const { submission, created } = await this.cycle.openClinicCycle(dto.clinicId, month);
      return {
        month,
        clinicId: dto.clinicId,
        created,
        submissionId: submission.id,
        status: submission.status,
      };
    }
    return this.scheduler.openCycleForMonth(month);
  }
}

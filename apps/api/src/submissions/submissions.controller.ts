import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { ClinicScopeGuard } from '../common/guards/clinic-scope.guard';
import { SubmissionsService } from './submissions.service';
import { ListSubmissionsQuery } from './dto/list-submissions.query';
import { currentMonthIST } from './month.util';

/**
 * Read surface for submissions (Phase 6). Any authenticated role; results are
 * clinic-scoped in the service (finance roles see all). The single-submission
 * route additionally uses ClinicScopeGuard (resolves the clinic from :id).
 */
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /**
   * With `clinicId` → that clinic's history; otherwise the per-clinic overview
   * for `month` (defaults to the current IST month) — the SPOC home.
   */
  @Get()
  list(@Query() query: ListSubmissionsQuery, @CurrentUser() user: RequestUser) {
    if (query.clinicId) {
      return this.submissions.listForClinic(query.clinicId, user, {
        statuses: query.status,
        month: query.month,
      });
    }
    if (query.status?.length) {
      return this.submissions.listQueue(user, { statuses: query.status, month: query.month });
    }
    return this.submissions.getOverview(user, query.month ?? currentMonthIST());
  }

  @Get(':submissionId')
  @UseGuards(ClinicScopeGuard)
  detail(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.submissions.getDetail(submissionId, user);
  }
}

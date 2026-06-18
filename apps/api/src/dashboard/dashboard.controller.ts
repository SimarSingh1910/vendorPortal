import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { ClinicMonthwiseQueryDto } from './dto/clinic-monthwise-query.dto';

/**
 * Dashboards & analytics (FR-07, Phase 11). Any authenticated role; every result
 * is clinic-scoped in the service (finance roles see all clinics, clinic roles
 * only their assigned clinics), so this one surface serves both the finance
 * central dashboard (11.1) and the SPOC/Manager dashboard (11.2).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** (a) Current-month submission-status tracker for the in-scope active clinics. */
  @Get('status')
  status(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.statusTracker(user, q.month);
  }

  /** (b) Month-on-month expense totals over the range. */
  @Get('monthly-totals')
  monthlyTotals(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.monthlyTotals(user, q);
  }

  /** (c) Expense-head-wise totals per month over the range. */
  @Get('head-trends')
  headTrends(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.headTrends(user, q);
  }

  /** (d) Clinic-wise totals over the range. */
  @Get('clinic-totals')
  clinicTotals(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.clinicTotals(user, q);
  }

  /** (e) Variance alerts vs the prior month (BR-12). */
  @Get('variance')
  variance(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.variance(user, q.month, q.clinicId);
  }

  /** Scoped clinic + expense-head options for the filter dropdowns. */
  @Get('filters')
  filters(@CurrentUser() user: RequestUser) {
    return this.dashboard.filterOptions(user);
  }

  /**
   * Month-wise report for one clinic (Step 4): current cycle month + N preceding.
   * Restricted to the roles that edit or review a clinic's data — SPOC and Clinic
   * Manager (own clinic only, enforced in the service via accessibleClinicIds) and
   * Finance Admin / Manager (any clinic). CLINIC_VIEWER is excluded by design.
   */
  @Get('clinic-monthwise')
  @Roles(
    UserRole.CLINIC_SPOC,
    UserRole.CLINIC_MANAGER,
    UserRole.FINANCE_ADMIN,
    UserRole.FINANCE_MANAGER,
  )
  clinicMonthwise(@Query() q: ClinicMonthwiseQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.clinicMonthwise(user, q.clinicId, q.months, q.month);
  }
}

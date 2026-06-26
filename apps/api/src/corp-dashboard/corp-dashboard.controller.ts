import { Controller, Get, Query } from '@nestjs/common';
import { PortalTab } from '@portal/shared';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { CorpDashboardService } from './corp-dashboard.service';
import { CorpDashboardQueryDto } from './dto/corp-dashboard-query.dto';

/**
 * Corporate dashboards & analytics (Step C4.1). Corporate tab only (TabGuard
 * blocks clinic roles, incl. the clinic FINANCE_MANAGER); every result is
 * department-scoped in the service (approvers/admin see all departments,
 * DEPT_SPOC/VIEWER only their assigned ones), so this one surface serves the
 * finance consolidated view and the department user view. All endpoints are READS
 * — no audit rows, no state changes.
 */
@Controller('corp/dashboard')
@RequireTab(PortalTab.CORPORATE)
export class CorpDashboardController {
  constructor(private readonly dashboard: CorpDashboardService) {}

  /** (a) Current-month submission-status tracker for in-scope active departments. */
  @Get('status')
  status(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.statusTracker(user, q.month);
  }

  /** (b) Month-on-month combined totals over the range. */
  @Get('monthly-totals')
  monthlyTotals(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.monthlyTotals(user, q);
  }

  /** (b') Month-on-month totals per department over the range. */
  @Get('dept-monthly-totals')
  deptMonthlyTotals(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.departmentMonthlyTotals(user, q);
  }

  /** (c) Expense-head drill-down (per-head totals per month) over the range. */
  @Get('head-trends')
  headTrends(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.headTrends(user, q);
  }

  /** (d) Cross-department totals over the range. */
  @Get('department-totals')
  departmentTotals(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.departmentTotals(user, q);
  }

  /** (f) Sec 24 dual display — total | HCL Avitas share | % used (frozen values). */
  @Get('sec24')
  sec24(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.sec24Dual(user, q);
  }

  /** (e) Variance alerts vs prior month at the configurable threshold (BR-12). */
  @Get('variance')
  variance(@Query() q: CorpDashboardQueryDto, @CurrentUser() user: RequestUser) {
    return this.dashboard.variance(user, q.month, q.departmentId);
  }

  /** Scoped department / expense-head / budget-code options for the filters. */
  @Get('filters')
  filters(@CurrentUser() user: RequestUser) {
    return this.dashboard.filterOptions(user);
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CorpSubmissionStatus, PortalTab } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeGuard } from './guards/corp-department-scope.guard';
import { CorpSubmissionsService } from './corp-submissions.service';
import { CorpSubmissionCommentsService } from './corp-submission-comments.service';

/**
 * Read surface for the corporate submission/provision workspace (Phase C2). All
 * corporate roles may read (TabGuard blocks clinic roles, incl. the clinic
 * FINANCE_MANAGER); CorpDepartmentScopeGuard restricts department-bound reads to
 * the caller's scope (approvers are org-wide). The review queue is approver-only.
 */
@Controller('corp')
@RequireTab(PortalTab.CORPORATE)
export class CorpSubmissionsController {
  constructor(
    private readonly submissions: CorpSubmissionsService,
    private readonly comments: CorpSubmissionCommentsService,
  ) {}

  /** SPOC/Viewer home: each accessible department's status for the month. */
  @Get('overview')
  overview(@CurrentUser() user: RequestUser, @Query('month') month: string) {
    return this.submissions.getOverview(user, month);
  }

  /** Approver review queue: every dept's SUBMITTED / in-review item, oldest first. */
  @Get('review/queue')
  @Roles(...CORP_FINANCE_APPROVER_ROLES)
  reviewQueue(@CurrentUser() user: RequestUser, @Query('month') month?: string) {
    return this.submissions.listQueue(user, {
      statuses: [CorpSubmissionStatus.SUBMITTED, CorpSubmissionStatus.FINANCE_MANAGER_REVIEW],
      month,
    });
  }

  /** A department's submission history. */
  @Get('departments/:departmentId/submissions')
  @UseGuards(CorpDepartmentScopeGuard)
  history(
    @Param('departmentId') departmentId: string,
    @CurrentUser() user: RequestUser,
    @Query('month') month?: string,
  ) {
    return this.submissions.listForDepartment(departmentId, user, { month });
  }

  /** Full provision form / detail for a single submission. */
  @Get('submissions/:submissionId')
  @UseGuards(CorpDepartmentScopeGuard)
  detail(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.submissions.getDetail(submissionId, user);
  }

  /** The submission's comment timeline (send-backs, approvals, submit notes). */
  @Get('submissions/:submissionId/comments')
  @UseGuards(CorpDepartmentScopeGuard)
  commentTimeline(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.comments.listForSubmission(submissionId, user);
  }
}

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeGuard } from './guards/corp-department-scope.guard';
import { CorpWorkflowService } from './corp-workflow.service';
import { SubmitDto } from '../submissions/dto/submit.dto';
import { ApproveDto } from '../submissions/dto/approve.dto';
import { SendBackDto } from '../submissions/dto/send-back.dto';
import { UnlockDto } from '../submissions/dto/unlock.dto';

/**
 * HTTP surface for corporate submission workflow transitions (Phase C2). Gated at
 * the edge by RolesGuard (@Roles), TabGuard (@RequireTab(CORPORATE) — this is
 * what blocks the clinic FINANCE_MANAGER from every corporate route), and, for
 * the SPOC, CorpDepartmentScopeGuard. CorpWorkflowService re-validates role,
 * department scope and state — guards are defence-in-depth, the service is
 * authoritative. Approver routes need no scope guard (approvers are org-wide).
 */
@Controller('corp/submissions/:submissionId')
@RequireTab(PortalTab.CORPORATE)
export class CorpSubmissionWorkflowController {
  constructor(private readonly workflow: CorpWorkflowService) {}

  // ── Dept SPOC ────────────────────────────────────────────────────────────────

  @Post('submit')
  @Roles(UserRole.DEPT_SPOC)
  @UseGuards(CorpDepartmentScopeGuard)
  submit(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SubmitDto,
  ) {
    return this.workflow.submit(id, user, dto.comment);
  }

  // ── Corporate approver (CORP_FINANCE_MANAGER / FINANCE_ADMIN) ──────────────────

  @Post('review/open')
  @Roles(...CORP_FINANCE_APPROVER_ROLES)
  openReview(@Param('submissionId') id: string, @CurrentUser() user: RequestUser) {
    return this.workflow.openReview(id, user);
  }

  @Post('review/approve')
  @Roles(...CORP_FINANCE_APPROVER_ROLES)
  approve(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ApproveDto,
  ) {
    return this.workflow.approve(id, user, dto.comment);
  }

  @Post('review/send-back')
  @Roles(...CORP_FINANCE_APPROVER_ROLES)
  sendBack(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendBackDto,
  ) {
    return this.workflow.sendBack(id, user, dto.comment);
  }

  /** Unlock an approved (locked) submission with a mandatory reason. Finance Admin only. */
  @Post('unlock')
  @Roles(UserRole.FINANCE_ADMIN)
  unlock(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UnlockDto,
  ) {
    return this.workflow.unlock(id, user, dto.reason);
  }
}

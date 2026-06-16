import { Body, Controller, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { ClinicScopeGuard } from '../common/guards/clinic-scope.guard';
import { WorkflowService } from './workflow.service';
import { SendBackDto } from './dto/send-back.dto';
import { ApproveDto } from './dto/approve.dto';
import { UnlockDto } from './dto/unlock.dto';

/**
 * HTTP surface for submission workflow transitions (Step 5.2). Each route is
 * gated at the edge by RolesGuard (@Roles) and, for clinic-scoped roles, by
 * ClinicScopeGuard (resolves the clinic from :submissionId). WorkflowService
 * re-validates role, clinic scope and state — guards are defence-in-depth, the
 * service is authoritative.
 */
@Controller('submissions/:submissionId')
export class SubmissionWorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  // ── SPOC ────────────────────────────────────────────────────────────────────

  @Post('submit')
  @Roles(UserRole.CLINIC_SPOC)
  @UseGuards(ClinicScopeGuard)
  submit(@Param('submissionId') id: string, @CurrentUser() user: RequestUser) {
    return this.workflow.submit(id, user);
  }

  // ── Manager ──────────────────────────────────────────────────────────────────

  @Post('manager/open')
  @Roles(UserRole.CLINIC_MANAGER)
  @UseGuards(ClinicScopeGuard)
  managerOpen(@Param('submissionId') id: string, @CurrentUser() user: RequestUser) {
    return this.workflow.managerOpenReview(id, user);
  }

  @Post('manager/approve')
  @Roles(UserRole.CLINIC_MANAGER)
  @UseGuards(ClinicScopeGuard)
  managerApprove(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ApproveDto,
  ) {
    return this.workflow.managerApprove(id, user, dto.comment);
  }

  @Post('manager/send-back')
  @Roles(UserRole.CLINIC_MANAGER)
  @UseGuards(ClinicScopeGuard)
  managerSendBack(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendBackDto,
  ) {
    return this.workflow.managerSendBack(id, user, dto.comment);
  }

  // ── Finance ──────────────────────────────────────────────────────────────────

  @Post('finance/open')
  @Roles(UserRole.FINANCE_ADMIN)
  financeOpen(@Param('submissionId') id: string, @CurrentUser() user: RequestUser) {
    return this.workflow.financeOpenReview(id, user);
  }

  @Post('finance/approve')
  @Roles(UserRole.FINANCE_ADMIN)
  financeApprove(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ApproveDto,
  ) {
    return this.workflow.financeApprove(id, user, dto.comment);
  }

  @Post('finance/send-back')
  @Roles(UserRole.FINANCE_ADMIN)
  financeSendBack(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendBackDto,
  ) {
    return this.workflow.financeSendBack(id, user, dto.comment);
  }

  /** Unlock an approved (locked) submission with a mandatory reason (Step 8.3). */
  @Post('finance/unlock')
  @Roles(UserRole.FINANCE_ADMIN)
  financeUnlock(
    @Param('submissionId') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UnlockDto,
    @Ip() ip: string,
  ) {
    return this.workflow.financeUnlock(id, user, dto.reason, ip);
  }
}

import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { ClinicScopeGuard } from '../common/guards/clinic-scope.guard';
import { SubmissionCommentsService } from './submission-comments.service';

/**
 * Submission comment timeline (Step 5.3). Any authenticated role may read,
 * scoped to clinics they can access — ClinicScopeGuard resolves the clinic from
 * :submissionId (finance roles see all). No @Roles: viewing isn't role-gated
 * beyond clinic scope.
 */
@Controller('submissions/:submissionId/comments')
@UseGuards(ClinicScopeGuard)
export class SubmissionCommentsController {
  constructor(private readonly comments: SubmissionCommentsService) {}

  @Get()
  list(@Param('submissionId') submissionId: string, @CurrentUser() user: RequestUser) {
    return this.comments.listForSubmission(submissionId, user);
  }
}

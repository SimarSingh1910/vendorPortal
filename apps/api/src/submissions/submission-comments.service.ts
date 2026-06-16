import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type SubmissionCommentAction, type SubmissionCommentView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * Read side of the submission comment trail (Step 5.3). Comments themselves are
 * written by WorkflowService during send-back/approve transitions; this exposes
 * them as a chronological timeline to the parties who can see the submission.
 */
@Injectable()
export class SubmissionCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
  ) {}

  /**
   * The submission's comments, oldest first. Visible to any user whose scope
   * covers the submission's clinic (finance roles see all). Re-checks scope here
   * even though the route guard already did — the service is authoritative.
   */
  async listForSubmission(submissionId: string, user: RequestUser): Promise<SubmissionCommentView[]> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { clinicId: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }

    const comments = await this.prisma.submissionComment.findMany({
      where: { submissionId },
      // id is the tie-breaker so same-millisecond comments stay in insert order.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { commentedBy: { select: { id: true, name: true } } },
    });

    return comments.map((c) => ({
      id: c.id,
      comment: c.comment,
      action: c.action as SubmissionCommentAction,
      roleAtTime: c.roleAtTime as UserRole,
      createdAt: c.createdAt.toISOString(),
      commentedBy: { id: c.commentedBy.id, name: c.commentedBy.name },
    }));
  }
}

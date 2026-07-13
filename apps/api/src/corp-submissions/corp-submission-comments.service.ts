import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type SubmissionCommentAction, type SubmissionCommentView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * Read side of the corporate submission comment trail (Step C2.2/C2.3). Comments
 * are written by CorpWorkflowService during submit/approve/send-back transitions;
 * this exposes them as a chronological timeline to anyone whose scope covers the
 * submission's department. Reuses the shared SubmissionCommentView shape.
 */
@Injectable()
export class CorpSubmissionCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CorpDepartmentScopeService,
  ) {}

  async listForSubmission(
    submissionId: string,
    user: RequestUser,
  ): Promise<SubmissionCommentView[]> {
    const submission = await this.prisma.corpMonthlySubmission.findUnique({
      where: { id: submissionId },
      select: { departmentId: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!(await this.scope.canAccessDepartment(user, submission.departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }

    const comments = await this.prisma.corpSubmissionComment.findMany({
      where: { submissionId },
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SubmissionStatus, type ProvisionEntryInput, type SubmissionDetail } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import type { RequestUser } from '../auth/request-user';
import { WorkflowService, isSpocEditable } from './workflow.service';
import { SubmissionsService } from './submissions.service';

/**
 * SPOC provision data entry (Step 6.1). Saving is a partial upsert of values
 * onto the submission's snapshot heads — tracking enteredBy (first write) and
 * lastModifiedBy (every write) — and moves the submission into DRAFT via the
 * authoritative state machine. Submitting (with BR-03/BR-07 enforcement) is the
 * separate WorkflowService.submit transition.
 */
@Injectable()
export class ProvisionEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
    private readonly workflow: WorkflowService,
    private readonly submissions: SubmissionsService,
  ) {}

  async saveEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
  ): Promise<SubmissionDetail> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, clinicId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    if (!isSpocEditable(submission.status as SubmissionStatus)) {
      throw new ConflictException(`Cannot edit a submission in ${submission.status}`);
    }

    if (items.length > 0) {
      // Every target must be a snapshot head of THIS submission.
      const snaps = await this.prisma.submissionExpenseHeadSnapshot.findMany({
        where: { submissionId },
        select: { id: true },
      });
      const valid = new Set(snaps.map((s) => s.id));
      for (const item of items) {
        if (!valid.has(item.snapshotId)) {
          throw new BadRequestException('Unknown snapshot head for this submission');
        }
      }

      await this.prisma.$transaction(
        items.map((item) =>
          this.prisma.provisionEntry.upsert({
            where: { snapshotId: item.snapshotId },
            update: { amount: item.amount, lastModifiedById: user.id },
            create: {
              submissionId,
              snapshotId: item.snapshotId,
              amount: item.amount,
              enteredById: user.id,
              lastModifiedById: user.id,
            },
          }),
        ),
      );
    }

    // Persisting progress moves NOT_STARTED / SENT_BACK_* into DRAFT (no-op if
    // already DRAFT). Routing through the state machine keeps it authoritative.
    await this.workflow.saveDraft(submissionId, user);

    return this.submissions.getDetail(submissionId, user);
  }
}

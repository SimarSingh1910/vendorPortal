import { Module } from '@nestjs/common';
import { ClinicExpenseHeadsModule } from '../clinic-expense-heads/clinic-expense-heads.module';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionCommentsService } from './submission-comments.service';
import { SubmissionsService } from './submissions.service';
import { ProvisionEntryService } from './provision-entry.service';
import { SubmissionWorkflowController } from './submission-workflow.controller';
import { SubmissionCommentsController } from './submission-comments.controller';
import { SubmissionsController } from './submissions.controller';
import { ProvisionEntryController } from './provision-entry.controller';

/**
 * Submission workflow engine (Phases 5–6). Step 5.1 ships cycle opening; 5.2 the
 * authoritative state machine + transition HTTP surface; 5.3 the comment timeline
 * read API; Phase 6 the SPOC read surface (overview/history/detail) and provision
 * data entry. CycleService is exported for the scheduler (Step 10.4);
 * WorkflowService is exported for cross-service transitions.
 */
@Module({
  imports: [ClinicExpenseHeadsModule],
  controllers: [
    SubmissionWorkflowController,
    SubmissionCommentsController,
    SubmissionsController,
    ProvisionEntryController,
  ],
  providers: [
    CycleService,
    WorkflowService,
    SubmissionCommentsService,
    SubmissionsService,
    ProvisionEntryService,
  ],
  exports: [CycleService, WorkflowService],
})
export class SubmissionsModule {}

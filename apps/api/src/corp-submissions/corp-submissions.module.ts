import { Module } from '@nestjs/common';
import { CorpExpenseHeadsModule } from '../corp-expense-heads/corp-expense-heads.module';
import { CorpCycleService } from './corp-cycle.service';
import { CorpDepartmentScopeService } from './corp-department-scope.service';
import { CorpWorkflowService } from './corp-workflow.service';
import { CorpProvisionEntryService } from './corp-provision-entry.service';
import { CorpSubmissionsService } from './corp-submissions.service';
import { CorpSubmissionCommentsService } from './corp-submission-comments.service';
import { CorpSubmissionWorkflowController } from './corp-submission-workflow.controller';
import { CorpProvisionEntryController } from './corp-provision-entry.controller';
import { CorpSubmissionsController } from './corp-submissions.controller';

/**
 * Corporate submission workflow engine (Phase C2). Step C2.1 ships cycle opening +
 * head snapshot; C2.2 the authoritative state machine + dept SPOC entry; C2.3 the
 * Corporate Finance Manager review/override/approve/send-back + Finance-Admin
 * unlock. Its own services, following the clinic SubmissionsModule pattern.
 * CorpCycleService is exported for the scheduler (Step C5); CorpWorkflowService
 * for cross-service transitions.
 */
@Module({
  imports: [CorpExpenseHeadsModule],
  controllers: [
    CorpSubmissionWorkflowController,
    CorpProvisionEntryController,
    CorpSubmissionsController,
  ],
  providers: [
    CorpCycleService,
    CorpDepartmentScopeService,
    CorpWorkflowService,
    CorpProvisionEntryService,
    CorpSubmissionsService,
    CorpSubmissionCommentsService,
  ],
  exports: [CorpCycleService, CorpWorkflowService],
})
export class CorpSubmissionsModule {}

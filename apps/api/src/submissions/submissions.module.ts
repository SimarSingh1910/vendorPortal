import { Module } from '@nestjs/common';
import { ClinicExpenseHeadsModule } from '../clinic-expense-heads/clinic-expense-heads.module';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionWorkflowController } from './submission-workflow.controller';

/**
 * Submission workflow engine (Phase 5). Step 5.1 ships the cycle-opening service;
 * Step 5.2 adds the authoritative state machine + transition HTTP surface. Later
 * steps add data entry / review screens. CycleService is exported so the scheduler
 * (Step 10.4) can invoke the open routine; WorkflowService is exported so the
 * data-entry step can drive the SAVE_DRAFT transition on save.
 */
@Module({
  imports: [ClinicExpenseHeadsModule],
  controllers: [SubmissionWorkflowController],
  providers: [CycleService, WorkflowService],
  exports: [CycleService, WorkflowService],
})
export class SubmissionsModule {}

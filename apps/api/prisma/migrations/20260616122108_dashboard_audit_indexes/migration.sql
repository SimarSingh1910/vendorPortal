-- CreateIndex
CREATE INDEX `AuditLog_action_idx` ON `AuditLog`(`action`);

-- CreateIndex
CREATE INDEX `AuditLog_clinicId_performedAt_idx` ON `AuditLog`(`clinicId`, `performedAt`);

-- RenameIndex
ALTER TABLE `submissionexpenseheadsnapshot` RENAME INDEX `SubmissionExpenseHeadSnapshot_expenseHeadId_fkey` TO `SubmissionExpenseHeadSnapshot_expenseHeadId_idx`;

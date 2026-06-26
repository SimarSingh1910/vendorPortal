-- Corporate submission expense-head snapshot (Step C2.1).
-- Mirrors the clinic snapshot pattern: freeze a department's active expense heads
-- onto the submission at cycle-open (BR-C11), and repoint corp_provision_entries
-- from the live head (expenseHeadId) to the frozen snapshot row (snapshotId, 1:1).
-- Corporate has no deployed data, so dropping expenseHeadId is non-destructive.

-- DropForeignKey
ALTER TABLE `corp_provision_entries` DROP FOREIGN KEY `corp_provision_entries_expenseHeadId_fkey`;

-- DropIndex
DROP INDEX `corp_provision_entries_expenseHeadId_idx` ON `corp_provision_entries`;

-- DropIndex
DROP INDEX `corp_provision_entries_submissionId_expenseHeadId_key` ON `corp_provision_entries`;

-- AlterTable
ALTER TABLE `corp_provision_entries` DROP COLUMN `expenseHeadId`,
    ADD COLUMN `snapshotId` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `corp_submission_expense_head_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `expenseHeadId` VARCHAR(191) NOT NULL,
    `expenseHeadNameAtSnapshot` VARCHAR(191) NOT NULL,

    INDEX `corp_submission_expense_head_snapshots_submissionId_idx`(`submissionId`),
    INDEX `corp_submission_expense_head_snapshots_expenseHeadId_idx`(`expenseHeadId`),
    UNIQUE INDEX `corp_submission_expense_head_snapshots_submissionId_expenseH_key`(`submissionId`, `expenseHeadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `corp_provision_entries_snapshotId_key` ON `corp_provision_entries`(`snapshotId`);

-- CreateIndex
CREATE UNIQUE INDEX `corp_provision_entries_submissionId_snapshotId_key` ON `corp_provision_entries`(`submissionId`, `snapshotId`);

-- AddForeignKey
ALTER TABLE `corp_submission_expense_head_snapshots` ADD CONSTRAINT `corp_submission_expense_head_snapshots_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `corp_monthly_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_submission_expense_head_snapshots` ADD CONSTRAINT `corp_submission_expense_head_snapshots_expenseHeadId_fkey` FOREIGN KEY (`expenseHeadId`) REFERENCES `corp_expense_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `corp_submission_expense_head_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

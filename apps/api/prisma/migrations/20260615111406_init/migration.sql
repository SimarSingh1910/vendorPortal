-- CreateTable
CREATE TABLE `Clinic` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `corporateClient` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Clinic_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseHead` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExpenseHead_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicExpenseHead` (
    `id` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `expenseHeadId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `ClinicExpenseHead_clinicId_idx`(`clinicId`),
    INDEX `ClinicExpenseHead_expenseHeadId_idx`(`expenseHeadId`),
    UNIQUE INDEX `ClinicExpenseHead_clinicId_expenseHeadId_key`(`clinicId`, `expenseHeadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('FINANCE_ADMIN', 'FINANCE_VIEWER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_role_idx`(`role`),
    INDEX `User_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserClinicAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,

    INDEX `UserClinicAssignment_userId_idx`(`userId`),
    INDEX `UserClinicAssignment_clinicId_idx`(`clinicId`),
    UNIQUE INDEX `UserClinicAssignment_userId_clinicId_key`(`userId`, `clinicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonthlySubmission` (
    `id` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `status` ENUM('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'CLINIC_MANAGER_REVIEW', 'CLINIC_APPROVED', 'FINANCE_REVIEW', 'FINANCE_APPROVED', 'SENT_BACK_BY_MANAGER', 'SENT_BACK_BY_FINANCE') NOT NULL DEFAULT 'NOT_STARTED',
    `submittedAt` DATETIME(3) NULL,
    `reviewStartedAt` DATETIME(3) NULL,
    `reviewStartedById` VARCHAR(191) NULL,
    `approvedByManagerAt` DATETIME(3) NULL,
    `approvedByFinanceAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `unlockedReason` TEXT NULL,
    `unlockedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MonthlySubmission_clinicId_idx`(`clinicId`),
    INDEX `MonthlySubmission_month_idx`(`month`),
    INDEX `MonthlySubmission_status_idx`(`status`),
    UNIQUE INDEX `MonthlySubmission_clinicId_month_key`(`clinicId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionExpenseHeadSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `expenseHeadId` VARCHAR(191) NOT NULL,
    `expenseHeadNameAtSnapshot` VARCHAR(191) NOT NULL,
    `expenseHeadCategoryAtSnapshot` VARCHAR(191) NOT NULL,

    INDEX `SubmissionExpenseHeadSnapshot_submissionId_idx`(`submissionId`),
    UNIQUE INDEX `SubmissionExpenseHeadSnapshot_submissionId_expenseHeadId_key`(`submissionId`, `expenseHeadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProvisionEntry` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `snapshotId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `enteredById` VARCHAR(191) NOT NULL,
    `enteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastModifiedById` VARCHAR(191) NOT NULL,
    `lastModifiedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProvisionEntry_snapshotId_key`(`snapshotId`),
    INDEX `ProvisionEntry_submissionId_idx`(`submissionId`),
    UNIQUE INDEX `ProvisionEntry_submissionId_snapshotId_key`(`submissionId`, `snapshotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionComment` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `comment` TEXT NOT NULL,
    `commentedById` VARCHAR(191) NOT NULL,
    `roleAtTime` ENUM('FINANCE_ADMIN', 'FINANCE_VIEWER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL,
    `action` ENUM('SENT_BACK', 'APPROVED') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SubmissionComment_submissionId_idx`(`submissionId`),
    INDEX `SubmissionComment_commentedById_idx`(`commentedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `performedById` VARCHAR(191) NOT NULL,
    `performedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(45) NOT NULL,

    INDEX `AuditLog_performedAt_idx`(`performedAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_performedById_idx`(`performedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submissionId` VARCHAR(191) NULL,

    INDEX `Notification_userId_idx`(`userId`),
    INDEX `Notification_isRead_idx`(`isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationConfig` (
    `id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `monthStartNotifyDate` DATETIME(3) NOT NULL,
    `cutoffDate` DATETIME(3) NOT NULL,
    `preCutoffReminderDays` INTEGER NOT NULL,
    `varianceThresholdPercent` DECIMAL(5, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationConfig_month_key`(`month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClinicExpenseHead` ADD CONSTRAINT `ClinicExpenseHead_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicExpenseHead` ADD CONSTRAINT `ClinicExpenseHead_expenseHeadId_fkey` FOREIGN KEY (`expenseHeadId`) REFERENCES `ExpenseHead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserClinicAssignment` ADD CONSTRAINT `UserClinicAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserClinicAssignment` ADD CONSTRAINT `UserClinicAssignment_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonthlySubmission` ADD CONSTRAINT `MonthlySubmission_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonthlySubmission` ADD CONSTRAINT `MonthlySubmission_reviewStartedById_fkey` FOREIGN KEY (`reviewStartedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonthlySubmission` ADD CONSTRAINT `MonthlySubmission_unlockedById_fkey` FOREIGN KEY (`unlockedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionExpenseHeadSnapshot` ADD CONSTRAINT `SubmissionExpenseHeadSnapshot_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `MonthlySubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionExpenseHeadSnapshot` ADD CONSTRAINT `SubmissionExpenseHeadSnapshot_expenseHeadId_fkey` FOREIGN KEY (`expenseHeadId`) REFERENCES `ExpenseHead`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProvisionEntry` ADD CONSTRAINT `ProvisionEntry_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `MonthlySubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProvisionEntry` ADD CONSTRAINT `ProvisionEntry_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `SubmissionExpenseHeadSnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProvisionEntry` ADD CONSTRAINT `ProvisionEntry_enteredById_fkey` FOREIGN KEY (`enteredById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProvisionEntry` ADD CONSTRAINT `ProvisionEntry_lastModifiedById_fkey` FOREIGN KEY (`lastModifiedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionComment` ADD CONSTRAINT `SubmissionComment_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `MonthlySubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionComment` ADD CONSTRAINT `SubmissionComment_commentedById_fkey` FOREIGN KEY (`commentedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `MonthlySubmission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

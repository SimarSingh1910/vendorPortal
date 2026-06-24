-- CreateTable
CREATE TABLE `corp_departments` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('STANDARD', 'INTERNAL_BU', 'SHARED_COST_POOL') NOT NULL DEFAULT 'STANDARD',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `corp_departments_isActive_idx`(`isActive`),
    INDEX `corp_departments_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_expense_heads` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `corp_expense_heads_departmentId_idx`(`departmentId`),
    INDEX `corp_expense_heads_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_budget_codes` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `corp_budget_codes_departmentId_idx`(`departmentId`),
    INDEX `corp_budget_codes_isActive_idx`(`isActive`),
    UNIQUE INDEX `corp_budget_codes_departmentId_code_key`(`departmentId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sec24_allocation_config` (
    `id` VARCHAR(191) NOT NULL,
    `allocationPct` DECIMAL(5, 2) NOT NULL,
    `setById` VARCHAR(191) NOT NULL,
    `setAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveFromMonth` VARCHAR(7) NOT NULL,
    `notes` TEXT NULL,

    INDEX `sec24_allocation_config_setById_idx`(`setById`),
    INDEX `sec24_allocation_config_effectiveFromMonth_idx`(`effectiveFromMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_monthly_submissions` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `status` ENUM('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'FINANCE_MANAGER_REVIEW', 'FINANCE_APPROVED', 'SENT_BACK_TO_SPOC') NOT NULL DEFAULT 'NOT_STARTED',
    `submittedAt` DATETIME(3) NULL,
    `financeApprovedAt` DATETIME(3) NULL,
    `lockedAt` DATETIME(3) NULL,
    `sec24PctSnapshot` DECIMAL(5, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `corp_monthly_submissions_departmentId_idx`(`departmentId`),
    INDEX `corp_monthly_submissions_month_idx`(`month`),
    INDEX `corp_monthly_submissions_status_idx`(`status`),
    UNIQUE INDEX `corp_monthly_submissions_departmentId_month_key`(`departmentId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_provision_entries` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `expenseHeadId` VARCHAR(191) NOT NULL,
    `budgetCodeId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `hclAvitasShare` DECIMAL(14, 2) NULL,
    `enteredById` VARCHAR(191) NOT NULL,
    `enteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastModifiedById` VARCHAR(191) NOT NULL,
    `lastModifiedAt` DATETIME(3) NOT NULL,

    INDEX `corp_provision_entries_submissionId_idx`(`submissionId`),
    INDEX `corp_provision_entries_expenseHeadId_idx`(`expenseHeadId`),
    INDEX `corp_provision_entries_budgetCodeId_idx`(`budgetCodeId`),
    UNIQUE INDEX `corp_provision_entries_submissionId_expenseHeadId_key`(`submissionId`, `expenseHeadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_submission_comments` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `comment` TEXT NOT NULL,
    `commentedById` VARCHAR(191) NOT NULL,
    `roleAtTime` ENUM('FINANCE_ADMIN', 'FINANCE_MANAGER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER', 'CORP_FINANCE_MANAGER', 'DEPT_SPOC', 'DEPT_VIEWER') NOT NULL,
    `action` ENUM('SENT_BACK', 'APPROVED', 'SUBMITTED', 'RECALLED') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `corp_submission_comments_submissionId_idx`(`submissionId`),
    INDEX `corp_submission_comments_commentedById_idx`(`commentedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_department_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,

    INDEX `user_department_assignments_userId_idx`(`userId`),
    INDEX `user_department_assignments_departmentId_idx`(`departmentId`),
    UNIQUE INDEX `user_department_assignments_userId_departmentId_key`(`userId`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `corp_expense_heads` ADD CONSTRAINT `corp_expense_heads_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `corp_departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_budget_codes` ADD CONSTRAINT `corp_budget_codes_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `corp_departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sec24_allocation_config` ADD CONSTRAINT `sec24_allocation_config_setById_fkey` FOREIGN KEY (`setById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_monthly_submissions` ADD CONSTRAINT `corp_monthly_submissions_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `corp_departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `corp_monthly_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_expenseHeadId_fkey` FOREIGN KEY (`expenseHeadId`) REFERENCES `corp_expense_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_budgetCodeId_fkey` FOREIGN KEY (`budgetCodeId`) REFERENCES `corp_budget_codes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_enteredById_fkey` FOREIGN KEY (`enteredById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_provision_entries` ADD CONSTRAINT `corp_provision_entries_lastModifiedById_fkey` FOREIGN KEY (`lastModifiedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_submission_comments` ADD CONSTRAINT `corp_submission_comments_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `corp_monthly_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corp_submission_comments` ADD CONSTRAINT `corp_submission_comments_commentedById_fkey` FOREIGN KEY (`commentedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_department_assignments` ADD CONSTRAINT `user_department_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_department_assignments` ADD CONSTRAINT `user_department_assignments_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `corp_departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE `auditlog` DROP FOREIGN KEY `AuditLog_performedById_fkey`;

-- AlterTable
ALTER TABLE `auditlog` ADD COLUMN `clinicId` VARCHAR(191) NULL,
    MODIFY `performedById` VARCHAR(191) NULL,
    MODIFY `ipAddress` VARCHAR(45) NULL;

-- CreateIndex
CREATE INDEX `AuditLog_clinicId_idx` ON `AuditLog`(`clinicId`);

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

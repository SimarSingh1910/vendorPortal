-- AlterTable: add the portal discriminator. NOT NULL DEFAULT 'CLINIC' backfills
-- every existing row to CLINIC (all pre-split config is clinic config).
ALTER TABLE `NotificationConfig` ADD COLUMN `portal` ENUM('CLINIC', 'CORPORATE') NOT NULL DEFAULT 'CLINIC';

-- DropIndex: the old month-only uniqueness (one config per month).
DROP INDEX `NotificationConfig_month_key` ON `NotificationConfig`;

-- CreateIndex: one config per (month, portal) — clinic and corporate are independent.
CREATE UNIQUE INDEX `NotificationConfig_month_portal_key` ON `NotificationConfig`(`month`, `portal`);

-- Clinic master: add fixed finance identifiers Acc. Location Code + Customer Code.
-- CLINIC ONLY — corporate tables and the append-only auditlog triggers are untouched.
-- Staged so existing clinics survive: a straight REQUIRED add would fail against them.
-- Not unique (per-clinic identifiers), so no unique index is created.

-- 1. Add both columns as NULLABLE first (no constraint yet).
ALTER TABLE `Clinic` ADD COLUMN `accLocationCode` VARCHAR(191) NULL;
ALTER TABLE `Clinic` ADD COLUMN `customerCode` VARCHAR(191) NULL;

-- 2. Backfill existing clinics with a clear, non-null placeholder so the admin
--    knows each must be replaced with the real code via the Finance Admin UI.
UPDATE `Clinic` SET `accLocationCode` = CONCAT('PENDING-', `id`) WHERE `accLocationCode` IS NULL;
UPDATE `Clinic` SET `customerCode` = CONCAT('PENDING-', `id`) WHERE `customerCode` IS NULL;

-- 3. Enforce NOT NULL now that every row has a value.
ALTER TABLE `Clinic` MODIFY `accLocationCode` VARCHAR(191) NOT NULL;
ALTER TABLE `Clinic` MODIFY `customerCode` VARCHAR(191) NOT NULL;

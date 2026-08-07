-- Clinic master: add the customer NAME alongside the existing customer CODE.
--
-- Why: the clinic previously carried only its name plus the two finance codes, so
-- the billing customer was readable nowhere — a code like `C91` says nothing, and
-- several clinics share a location name across DIFFERENT customers (two "Mumbai",
-- two "Noida Sec 24", two "Greater Noida, Knowledge Park", two "Bengaluru -
-- Marathahalli", two "SSN Chennai"). The name is what tells those apart in the
-- admin list and on the finance export.
--
-- This restores, deliberately, the readable-customer field that
-- 20260708170000_clinic_drop_location_corporate_client dropped as `corporateClient`.
-- It is NOT that column returning by accident: it is required, it is master data set
-- by the Finance Admin, and it now has a defined source (the clinic master
-- spreadsheet), which `corporateClient` never had.
--
-- CLINIC ONLY — corporate tables and the append-only auditlog triggers are untouched.
-- Not unique: many clinics legitimately share one customer.
-- Staged exactly like the acc-location/customer-code migration, so existing clinics
-- survive: a straight REQUIRED add would fail against them.

-- 1. Add as NULLABLE first (no constraint yet).
ALTER TABLE `Clinic` ADD COLUMN `customerName` VARCHAR(191) NULL;

-- 2. Backfill existing clinics with a clear, non-null placeholder so the admin knows
--    each must be replaced with the real name via the Finance Admin UI. Deliberately
--    the same `PENDING-<id>` convention the codes used — a visible marker, never a
--    guess at what the customer might be.
UPDATE `Clinic` SET `customerName` = CONCAT('PENDING-', `id`) WHERE `customerName` IS NULL;

-- 3. Enforce NOT NULL now that every row has a value.
ALTER TABLE `Clinic` MODIFY `customerName` VARCHAR(191) NOT NULL;

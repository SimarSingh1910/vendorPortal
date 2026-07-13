-- Clinic provision entry: add an optional free-text vendor name per line.
-- CLINIC ONLY — nullable & additive (no backfill needed); the snapshot tables and
-- the append-only auditlog triggers are untouched.
ALTER TABLE `ProvisionEntry` ADD COLUMN `vendorName` TEXT NULL;

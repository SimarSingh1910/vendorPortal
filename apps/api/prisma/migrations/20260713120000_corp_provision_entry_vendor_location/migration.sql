-- Corporate provision entry: add optional free-text Vendor Name + Location per line.
-- CORPORATE ONLY — nullable & additive (no backfill needed). Both are per-line SPOC
-- free text (Location is NOT a master/dropdown here, unlike the clinic side). The
-- corp snapshot tables and the append-only auditlog triggers are untouched.
ALTER TABLE `corp_provision_entries`
  ADD COLUMN `vendorName` TEXT NULL,
  ADD COLUMN `location` TEXT NULL;

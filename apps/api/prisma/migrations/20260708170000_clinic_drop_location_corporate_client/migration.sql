-- Clinic master: drop `location` and `corporateClient`. The clinic now carries only
-- its name plus the fixed finance identifiers (accLocationCode, customerCode).
-- CLINIC ONLY — corporate tables and the append-only auditlog triggers are untouched.
-- Both columns were pure master-data display fields (no business logic depends on them).

ALTER TABLE `Clinic` DROP COLUMN `location`;
ALTER TABLE `Clinic` DROP COLUMN `corporateClient`;

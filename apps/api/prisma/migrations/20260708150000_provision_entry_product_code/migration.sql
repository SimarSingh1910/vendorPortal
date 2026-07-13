-- Clinic provision entry: add an optional Product Code the SPOC picks from a FIXED
-- predefined set (validated at the API against PRODUCT_CODES in @portal/shared).
-- CLINIC ONLY — corporate entries and the snapshot tables are untouched.
-- Simple additive, nullable column (entered data on the entry, never snapshotted).

ALTER TABLE `ProvisionEntry` ADD COLUMN `productCode` VARCHAR(191) NULL;

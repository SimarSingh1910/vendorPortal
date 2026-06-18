-- Convert the FINANCE_VIEWER role to FINANCE_MANAGER (Step 1).
--
-- Done in three phases PER COLUMN so existing rows are preserved — a plain
-- enum drop/recreate would null out any row holding the removed value:
--   (a) widen the enum to include BOTH the old and new values,
--   (b) migrate existing rows from the old value to the new,
--   (c) narrow the enum to drop the old value.
--
-- The `UserRole` enum backs two columns: `User`.`role` and
-- `SubmissionComment`.`roleAtTime`; both are migrated here. Table names are
-- written PascalCase to match the original migrations; the dev/test MySQL runs
-- with lower_case_table_names=1, which resolves them case-insensitively.

-- (a) widen — add FINANCE_MANAGER alongside the existing values.
ALTER TABLE `User`
  MODIFY `role` ENUM('FINANCE_ADMIN', 'FINANCE_VIEWER', 'FINANCE_MANAGER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL;
ALTER TABLE `SubmissionComment`
  MODIFY `roleAtTime` ENUM('FINANCE_ADMIN', 'FINANCE_VIEWER', 'FINANCE_MANAGER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL;

-- (b) migrate existing rows. Bumping tokenVersion + revoking refresh tokens is
-- the SQL equivalent of AuthService.invalidateUserSessions: it forces the
-- converted users to re-authenticate so their new permissions apply immediately.
UPDATE `User`
  SET `role` = 'FINANCE_MANAGER', `tokenVersion` = `tokenVersion` + 1
  WHERE `role` = 'FINANCE_VIEWER';
UPDATE `SubmissionComment` SET `roleAtTime` = 'FINANCE_MANAGER' WHERE `roleAtTime` = 'FINANCE_VIEWER';

-- Revoke any live refresh tokens for the just-converted users (no FINANCE_MANAGER
-- existed before this migration, so this targets exactly the converted rows).
UPDATE `RefreshToken`
  SET `revokedAt` = NOW()
  WHERE `revokedAt` IS NULL
    AND `userId` IN (SELECT `id` FROM `User` WHERE `role` = 'FINANCE_MANAGER');

-- (c) narrow — drop FINANCE_VIEWER. Final shape matches schema.prisma.
ALTER TABLE `User`
  MODIFY `role` ENUM('FINANCE_ADMIN', 'FINANCE_MANAGER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL;
ALTER TABLE `SubmissionComment`
  MODIFY `roleAtTime` ENUM('FINANCE_ADMIN', 'FINANCE_MANAGER', 'CLINIC_MANAGER', 'CLINIC_SPOC', 'CLINIC_VIEWER') NOT NULL;

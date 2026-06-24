-- Corporate Provisions module (Step C0.1): add three roles to the shared
-- UserRole enum — CORP_FINANCE_MANAGER, DEPT_SPOC, DEPT_VIEWER.
--
-- Purely ADDITIVE: this WIDENS the enum (appends new members) and touches no
-- rows. A plain drop/recreate would null out any row holding an existing value,
-- so we only MODIFY the column to the wider member list — no data migration is
-- needed because no existing value is removed or renamed.
--
-- The `UserRole` enum backs two columns: `User`.`role` and
-- `SubmissionComment`.`roleAtTime`; both are widened here. Member order matches
-- schema.prisma (clinic roles first, the three corporate roles appended last).
-- Table names are PascalCase to match the original migrations; dev/test MySQL
-- runs with lower_case_table_names=1, which resolves them case-insensitively.

ALTER TABLE `User`
  MODIFY `role` ENUM(
    'FINANCE_ADMIN',
    'FINANCE_MANAGER',
    'CLINIC_MANAGER',
    'CLINIC_SPOC',
    'CLINIC_VIEWER',
    'CORP_FINANCE_MANAGER',
    'DEPT_SPOC',
    'DEPT_VIEWER'
  ) NOT NULL;

ALTER TABLE `SubmissionComment`
  MODIFY `roleAtTime` ENUM(
    'FINANCE_ADMIN',
    'FINANCE_MANAGER',
    'CLINIC_MANAGER',
    'CLINIC_SPOC',
    'CLINIC_VIEWER',
    'CORP_FINANCE_MANAGER',
    'DEPT_SPOC',
    'DEPT_VIEWER'
  ) NOT NULL;

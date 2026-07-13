-- Clinic ExpenseHead: replace {name, category} with {glAccountNo, glAccountName}.
-- CLINIC ONLY — CorpExpenseHead and the append-only auditlog triggers are untouched.
-- Staged so existing rows survive and glAccountNo ends up NOT NULL + UNIQUE.

-- 1. Rename `name` -> `glAccountName` (descriptive labels carry over intact).
ALTER TABLE `ExpenseHead` CHANGE `name` `glAccountName` VARCHAR(191) NOT NULL;

-- 2. Add `glAccountNo` as NULLABLE first (no constraint yet).
ALTER TABLE `ExpenseHead` ADD COLUMN `glAccountNo` VARCHAR(191) NULL;

-- 3. Backfill existing rows with a unique, non-null placeholder (`TEMP-<id>`).
--    These are NOT real account numbers — replace them via the Finance Admin UI.
UPDATE `ExpenseHead` SET `glAccountNo` = CONCAT('TEMP-', `id`) WHERE `glAccountNo` IS NULL;

-- 4. Enforce NOT NULL + UNIQUE now that every row has a distinct value.
ALTER TABLE `ExpenseHead` MODIFY `glAccountNo` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `ExpenseHead_glAccountNo_key` ON `ExpenseHead`(`glAccountNo`);

-- 5. Drop the former `category` (its values are not account numbers).
ALTER TABLE `ExpenseHead` DROP COLUMN `category`;

-- ── Submission snapshot: freeze BOTH G/L fields at cycle-open going forward ──────
-- Rename the frozen name column (historical frozen values carry over unchanged).
ALTER TABLE `SubmissionExpenseHeadSnapshot`
  CHANGE `expenseHeadNameAtSnapshot` `expenseHeadGlNameAtSnapshot` VARCHAR(191) NOT NULL;

-- Add the frozen G/L-no column (nullable first), then backfill historical rows from
-- their head's (placeholder) glAccountNo so old snapshots stay non-null and readable.
ALTER TABLE `SubmissionExpenseHeadSnapshot` ADD COLUMN `expenseHeadGlNoAtSnapshot` VARCHAR(191) NULL;
UPDATE `SubmissionExpenseHeadSnapshot` `s`
  JOIN `ExpenseHead` `e` ON `e`.`id` = `s`.`expenseHeadId`
  SET `s`.`expenseHeadGlNoAtSnapshot` = `e`.`glAccountNo`
  WHERE `s`.`expenseHeadGlNoAtSnapshot` IS NULL;
ALTER TABLE `SubmissionExpenseHeadSnapshot` MODIFY `expenseHeadGlNoAtSnapshot` VARCHAR(191) NOT NULL;

-- Drop the frozen category column (dropped from the master, so dropped here too).
ALTER TABLE `SubmissionExpenseHeadSnapshot` DROP COLUMN `expenseHeadCategoryAtSnapshot`;

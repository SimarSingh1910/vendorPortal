-- Multiple vendor rows for flagged clinic G/L heads. CLINIC ONLY — corporate
-- models (CorpExpenseHead / CorpProvisionEntry / snapshots) are untouched.
--
--  1) A head DEFINITION flag `allowsMultipleVendors` on the master, carried onto
--     the head snapshot at cycle-open (BR-05 non-retroactivity).
--  2) Relax the one-entry-per-head constraint so a head snapshot may hold MANY
--     provision-entry lines; each line keeps its own row id and a `lineOrder`.
--  3) `amount` becomes NULLABLE — a started-but-blank line has no amount yet
--     (blank != 0). Submit still requires every line to carry a non-null amount.

-- 1) Multi-vendor flag on the master + frozen onto the snapshot.
ALTER TABLE `ExpenseHead`
  ADD COLUMN `allowsMultipleVendors` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `SubmissionExpenseHeadSnapshot`
  ADD COLUMN `expenseHeadAllowsMultipleVendorsAtSnapshot` BOOLEAN NOT NULL DEFAULT false;

-- 2) Relax the one-entry-per-head constraint. Add the replacement (non-unique)
-- index on snapshotId FIRST — the snapshotId foreign key relies on an index, so
-- the old unique key cannot be dropped until this one exists to cover the FK.
CREATE INDEX `ProvisionEntry_snapshotId_idx` ON `ProvisionEntry`(`snapshotId`);
DROP INDEX `ProvisionEntry_snapshotId_key` ON `ProvisionEntry`;
DROP INDEX `ProvisionEntry_submissionId_snapshotId_key` ON `ProvisionEntry`;

-- Stable line ordering within a head.
ALTER TABLE `ProvisionEntry`
  ADD COLUMN `lineOrder` INTEGER NOT NULL DEFAULT 0;

-- 3) Widen amount to nullable (existing rows keep their values).
ALTER TABLE `ProvisionEntry`
  MODIFY `amount` DECIMAL(14, 2) NULL;

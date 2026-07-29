-- Particulars under each clinic vendor line. CLINIC ONLY — corporate models
-- (CorpExpenseHead / CorpProvisionEntry / snapshots) are untouched.
--
-- The vendor line no longer carries a TYPED amount. It carries 1..n particulars,
-- each `rate` × `quantity` = `value`, and every money figure above a particular is
-- a derived sum:
--
--     particular.value      = ROUND_HALF_UP(rate * quantity, 2)   [computed]
--     vendorLine.amount     = SUM(its particulars' values)        [computed cache]
--     head "Amount (₹)"     = SUM(its vendor lines' amounts)      [computed]
--
-- `ProvisionEntry.amount` is KEPT (not dropped) and repurposed as a server-computed
-- cache: it is rewritten from the stored particulars on every save and a
-- client-sent amount is always ignored. Keeping it preserves the existing
-- dashboard/export aggregation, which reads SUM(p.amount) and relies on
-- `p.amount IS NOT NULL` to keep incomplete drafts out of finance totals.

-- 1) The particulars table.
--
-- rate is DECIMAL(14,4) and quantity DECIMAL(14,3) so paise-fraction unit prices and
-- fractional quantities survive without float drift; value is DECIMAL(14,2) (INR,
-- like every other money column). All four value columns are NULLABLE because
-- NULL ≠ 0: a half-filled particular is incomplete and blocks submit, while an
-- explicit 0 rate is valid and yields a 0.00 value.
CREATE TABLE `EntryParticular` (
  `id`             VARCHAR(191)   NOT NULL,
  `entryId`        VARCHAR(191)   NOT NULL,
  `lineOrder`      INTEGER        NOT NULL DEFAULT 0,
  `particularName` TEXT           NULL,
  `rate`           DECIMAL(14, 4) NULL,
  `quantity`       DECIMAL(14, 3) NULL,
  `value`          DECIMAL(14, 2) NULL,
  `createdAt`      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)    NOT NULL,

  INDEX `EntryParticular_entryId_idx`(`entryId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EntryParticular`
  ADD CONSTRAINT `EntryParticular_entryId_fkey`
  FOREIGN KEY (`entryId`) REFERENCES `ProvisionEntry`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Backfill — every existing vendor line must end up with AT LEAST ONE
-- particular, and its derived amount must equal what it already showed.
--
-- A line that HAS an amount becomes one particular carrying that whole figure as
-- rate × 1, so value = rate * quantity = the original amount exactly and the
-- vendor-line/head totals are byte-for-byte unchanged for historical months
-- (including approved/locked submissions, whose figures must not move).
--
-- A line with a NULL amount was a started-but-blank draft row; it becomes one
-- blank particular (NULL name/rate/quantity/value), which is still "incomplete"
-- and still blocks submit — the same state it was in before this migration.
INSERT INTO `EntryParticular`
  (`id`, `entryId`, `lineOrder`, `particularName`, `rate`, `quantity`, `value`, `createdAt`, `updatedAt`)
SELECT
  UUID(),
  `p`.`id`,
  0,
  CASE WHEN `p`.`amount` IS NULL THEN NULL ELSE 'Amount' END,
  `p`.`amount`,
  CASE WHEN `p`.`amount` IS NULL THEN NULL ELSE 1 END,
  `p`.`amount`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `ProvisionEntry` `p`;

-- Move the SPOC's free-text explanation DOWN one level: from the vendor line
-- (`ProvisionEntry.note`) onto the particular it explains (`EntryParticular.remark`).
--
-- Why: the note used to hang off the G/L head / vendor line, one level above the
-- figures it was explaining. Values are typed at the particular (rate × quantity),
-- so that is where "why did this change" belongs. The finance export already emits
-- ONE ROW PER PARTICULAR, so its Description column now carries a remark that is
-- actually specific to the row it sits on instead of the line's note repeated down
-- every particular of that line.
--
-- CLINIC ONLY. `CorpProvisionEntry.note` is deliberately untouched: corporate lines
-- have no particulars, so there is no lower level for it to move to.
-- `SubmissionComment` (the review comment thread) is a separate feature and is not
-- involved here.

-- 1) The new per-particular remark. Nullable, TEXT, same length class as the note
--    it replaces. Blank/whitespace is normalised to NULL by the service — a remark
--    is either real text or absent, never an empty-string placeholder (NULL ≠ '').
ALTER TABLE `EntryParticular` ADD COLUMN `remark` TEXT NULL;

-- 2) Carry existing notes across rather than dropping them: each line's note lands
--    on that line's FIRST particular (lineOrder = 0 — every line is guaranteed to
--    have one). The note described the line as a whole, so copying it onto every
--    particular would fabricate a per-row explanation that nobody wrote; the first
--    row is the one the export/review reads first.
UPDATE `EntryParticular` `ep`
  JOIN `ProvisionEntry` `p` ON `p`.`id` = `ep`.`entryId`
   SET `ep`.`remark` = `p`.`note`
 WHERE `ep`.`lineOrder` = 0
   AND `p`.`note` IS NOT NULL;

-- 3) Drop the old line-level column. Nothing else reads it: the clinic export's
--    Description now sources from `EntryParticular.remark`, the review screens show
--    the per-particular remark, and the audit before-image records it at the
--    particular level.
ALTER TABLE `ProvisionEntry` DROP COLUMN `note`;

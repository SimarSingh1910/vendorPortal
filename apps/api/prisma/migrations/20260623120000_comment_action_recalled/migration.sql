-- SPOC recall: a SPOC may attach an optional reason when recalling a submission
-- back to DRAFT. Add RECALLED to the CommentAction enum (backs
-- SubmissionComment.action). Purely additive — an enum widen, no data change.
-- Order matches schema.prisma (appended last).
ALTER TABLE `SubmissionComment`
  MODIFY `action` ENUM('SENT_BACK', 'APPROVED', 'SUBMITTED', 'RECALLED') NOT NULL;

-- Step 3: a SPOC may attach an optional note when submitting. Add SUBMITTED to
-- the CommentAction enum (backs SubmissionComment.action). Purely additive — an
-- enum widen, no data change. Order matches schema.prisma (appended last).
ALTER TABLE `SubmissionComment`
  MODIFY `action` ENUM('SENT_BACK', 'APPROVED', 'SUBMITTED') NOT NULL;

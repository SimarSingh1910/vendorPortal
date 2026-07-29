-- Attachments on review comments — PROOF for an override, send-back or approval
-- (an email screenshot, a photo of a quote, a PDF). Shared by BOTH portals.
--
-- STORAGE: the bytes live in this table, not on local disk. The deploy target's
-- filesystem is ephemeral, so disk-backed uploads would be lost on redeploy.
-- This is the documented demo-grade choice; production should move the bytes to
-- object storage (S3) and keep only a storage key in this row. The size/count
-- caps enforced in the API are deliberately tight precisely because DB blobs do
-- not scale.
--
-- IMMUTABLE + APPEND-ONLY: rows are written once, in the same transaction as the
-- comment they evidence, and the API exposes no update or delete path. They are
-- removed only by cascade when their comment (and so its submission) goes.

CREATE TABLE `CommentAttachment` (
  `id`                      VARCHAR(191) NOT NULL,

  -- EXACTLY ONE of these two is set: an attachment hangs off either a clinic
  -- review comment or a corporate one, never both and never neither.
  --
  -- This is enforced in AttachmentsService (the only writer), NOT by a CHECK
  -- constraint: MySQL refuses a CHECK on a column that also carries a foreign key
  -- with a referential action, and the ON DELETE CASCADE below is worth more here
  -- than a redundant constraint — it is what guarantees an attachment can never
  -- outlive the comment it evidences. Don't try to re-add the CHECK; it fails with
  -- "cannot be used in a check constraint: needed in a foreign key constraint".
  `submissionCommentId`     VARCHAR(191) NULL,
  `corpSubmissionCommentId` VARCHAR(191) NULL,

  -- Sanitized original filename (basename only). Never used to touch a
  -- filesystem — it is only echoed back as the download filename.
  `fileName`   VARCHAR(255) NOT NULL,
  -- Server-validated content type, restricted to the allowed set.
  `mimeType`   VARCHAR(191) NOT NULL,
  `sizeBytes`  INTEGER      NOT NULL,
  -- MEDIUMBLOB = 16 MB ceiling, comfortably above the per-file cap.
  `data`       MEDIUMBLOB   NOT NULL,

  `uploadedById` VARCHAR(191) NOT NULL,
  `uploadedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `CommentAttachment_submissionCommentId_idx`(`submissionCommentId`),
  INDEX `CommentAttachment_corpSubmissionCommentId_idx`(`corpSubmissionCommentId`),
  INDEX `CommentAttachment_uploadedById_idx`(`uploadedById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Cascade on both parents: an attachment never outlives the comment it evidences
-- (and a comment never outlives its submission).
ALTER TABLE `CommentAttachment`
  ADD CONSTRAINT `CommentAttachment_submissionCommentId_fkey`
  FOREIGN KEY (`submissionCommentId`) REFERENCES `SubmissionComment`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CommentAttachment`
  ADD CONSTRAINT `CommentAttachment_corpSubmissionCommentId_fkey`
  FOREIGN KEY (`corpSubmissionCommentId`) REFERENCES `corp_submission_comments`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Uploader is RESTRICT (Prisma default): a user who has attached proof cannot be
-- hard-deleted out from under the evidence trail. Users are deactivated, never
-- deleted, so this is a backstop rather than a live constraint.
ALTER TABLE `CommentAttachment`
  ADD CONSTRAINT `CommentAttachment_uploadedById_fkey`
  FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

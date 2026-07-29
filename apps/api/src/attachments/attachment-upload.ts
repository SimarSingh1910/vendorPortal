import { FilesInterceptor } from '@nestjs/platform-express';
import { ATTACHMENT_LIMITS } from '@portal/shared';
import type { UploadedFile } from './attachments.service';

/** The multipart field name every attach-capable route reads its files from. */
export const ATTACHMENT_FIELD = 'attachments';

/**
 * The interceptor for a route that accepts review-comment attachments.
 *
 * Files are buffered in MEMORY, never written to disk — the deploy target's
 * filesystem is ephemeral, and buffers hand straight to the service which writes
 * them inside the comment's transaction. That is what makes the save atomic.
 *
 * The limits here are a FIRST line of defence, not the gate: multer aborts an
 * oversize or over-count upload mid-stream so a hostile request can't buffer
 * gigabytes before anyone looks at it. AttachmentsService.validateBatch then
 * re-checks everything (including type and extension, which multer knows nothing
 * about) on the bytes that actually arrived.
 */
export const AttachmentUpload = () =>
  FilesInterceptor(ATTACHMENT_FIELD, ATTACHMENT_LIMITS.maxFiles, {
    limits: {
      fileSize: ATTACHMENT_LIMITS.maxFileBytes,
      files: ATTACHMENT_LIMITS.maxFiles,
      // Only the small text fields (comment/reason) accompany the files.
      fields: 10,
    },
  });

/**
 * Normalise what multer hands the controller. The parameter is absent entirely
 * for a JSON request with no files, which is the common case — every attach-capable
 * route still accepts a plain body.
 */
export function toUploadedFiles(files?: UploadedFile[]): UploadedFile[] {
  return files ?? [];
}

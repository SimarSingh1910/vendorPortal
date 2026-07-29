import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ATTACHMENT_LIMITS,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  formatFileSize,
  isAllowedAttachment,
  type CommentAttachmentView,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import type { RequestUser } from '../auth/request-user';

/**
 * An uploaded file as this service needs it. Structurally what multer's
 * memory storage produces, declared locally rather than imported so the service
 * has no transport dependency — the day the bytes come from a pre-signed S3 PUT
 * instead of a multipart body, only the caller changes.
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Which portal's comment an attachment hangs off. Exactly one, never both. */
export type AttachmentParent =
  | { portal: 'clinic'; commentId: string }
  | { portal: 'corp'; commentId: string };

/** A downloadable attachment: metadata plus the bytes. */
export interface AttachmentDownload {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
}

/**
 * Review-comment attachments — proof for an override, send-back or approval.
 * ONE service for BOTH portals: clinic and corporate comments differ only in
 * which parent id is set and which scope check gates access.
 *
 * Two responsibilities, both security-critical:
 *
 *  1. VALIDATION IS THE GATE. Type, extension, per-file size, file count and
 *     total bytes are all re-checked here on every upload. The web app applies
 *     the same rules (shared from @portal/shared) purely so the user finds out
 *     before a doomed round-trip — a caller that skips them, or a hand-rolled
 *     curl, hits exactly the same wall.
 *
 *  2. ACCESS IS INHERITED. An attachment is exactly as visible as the submission
 *     whose comment it hangs off; `download` re-resolves that submission and runs
 *     the same clinic/department scope check the submission's own endpoints use.
 *     There are no public or unauthenticated file URLs.
 *
 * Attachments are IMMUTABLE once written: this service exposes create and read
 * only. There is deliberately no update or delete — they are evidence.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicScope: ClinicScopeService,
    private readonly corpScope: CorpDepartmentScopeService,
  ) {}

  /**
   * Validate a batch BEFORE anything is written, so a rejected upload never
   * leaves a partial trail. Throws a 400 naming the offending file and the rule
   * it broke — "rejected" with no reason is useless to the person holding the
   * evidence.
   */
  validateBatch(files: UploadedFile[]): void {
    if (files.length > ATTACHMENT_LIMITS.maxFiles) {
      throw new BadRequestException(
        `At most ${ATTACHMENT_LIMITS.maxFiles} files may be attached to a comment (got ${files.length})`,
      );
    }

    let total = 0;
    for (const file of files) {
      const name = this.sanitizeFileName(file.originalname);
      if (!name) {
        throw new BadRequestException('An attached file has no usable filename');
      }
      // Type AND extension must agree — a renamed executable satisfies neither.
      if (!isAllowedAttachment(file.mimetype, name)) {
        throw new BadRequestException(
          `“${name}” is not an allowed file type. Allowed: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`,
        );
      }
      // Trust the BUFFER's length, not the client-declared size field.
      const size = file.buffer.length;
      if (size === 0) {
        throw new BadRequestException(`“${name}” is empty`);
      }
      if (size > ATTACHMENT_LIMITS.maxFileBytes) {
        throw new BadRequestException(
          `“${name}” is ${formatFileSize(size)} — the limit is ${formatFileSize(ATTACHMENT_LIMITS.maxFileBytes)} per file`,
        );
      }
      total += size;
    }

    if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
      throw new BadRequestException(
        `Attachments total ${formatFileSize(total)} — the limit is ${formatFileSize(ATTACHMENT_LIMITS.maxTotalBytes)} per comment`,
      );
    }
  }

  /**
   * Persist a validated batch against a comment, INSIDE the caller's transaction.
   *
   * Taking `tx` rather than opening its own is the whole point: the files and the
   * comment they evidence commit together or not at all. A failed comment save
   * leaves no orphaned bytes, and a failed attachment write rolls the comment
   * (and its whole workflow transition) back with it.
   */
  async persist(
    tx: Prisma.TransactionClient,
    parent: AttachmentParent,
    files: UploadedFile[],
    uploadedById: string,
  ): Promise<void> {
    if (files.length === 0) return;
    // Re-validate inside the transaction: `persist` is never reachable without a
    // prior validateBatch today, but this is the last line before bytes land.
    this.validateBatch(files);

    for (const file of files) {
      await tx.commentAttachment.create({
        data: {
          submissionCommentId: parent.portal === 'clinic' ? parent.commentId : null,
          corpSubmissionCommentId: parent.portal === 'corp' ? parent.commentId : null,
          fileName: this.sanitizeFileName(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          sizeBytes: file.buffer.length,
          // Prisma's Bytes maps to Uint8Array<ArrayBuffer>; a Node Buffer may be
          // backed by a SharedArrayBuffer, so narrow it explicitly rather than
          // widening the column type.
          data: new Uint8Array(file.buffer),
          uploadedById,
        },
      });
    }
  }

  /**
   * Fetch an attachment's bytes for download, enforcing the SAME access rule as
   * the submission it belongs to: a user who cannot see the submission cannot see
   * its proof. Clinic attachments run the clinic-scope check, corporate ones the
   * department check; finance/corp-finance roles are org-wide as everywhere else.
   *
   * This is a READ. It deliberately writes NO audit row — viewing evidence is not
   * an event in the trail (only adding it is, on the comment's own action).
   */
  async download(attachmentId: string, user: RequestUser): Promise<AttachmentDownload> {
    const attachment = await this.prisma.commentAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        submissionComment: { select: { submission: { select: { clinicId: true } } } },
        corpSubmissionComment: { select: { submission: { select: { departmentId: true } } } },
      },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    if (attachment.submissionComment) {
      const { clinicId } = attachment.submissionComment.submission;
      if (!this.clinicScope.canAccessClinic(user, clinicId)) {
        throw new ForbiddenException('Clinic not in your accessible scope');
      }
    } else if (attachment.corpSubmissionComment) {
      const { departmentId } = attachment.corpSubmissionComment.submission;
      if (!(await this.corpScope.canAccessDepartment(user, departmentId))) {
        throw new ForbiddenException('Department not in your accessible scope');
      }
    } else {
      // Neither parent set — the exactly-one invariant is broken. Fail closed
      // rather than serve a file nothing can authorise.
      throw new NotFoundException('Attachment not found');
    }

    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      data: Buffer.from(attachment.data),
    };
  }

  /**
   * Strip everything but a safe basename. The client-supplied path is NEVER
   * trusted: directory components (both separators, so a Windows client can't
   * smuggle one past a POSIX server), control characters and leading dots all go.
   * The result is only ever echoed back as a download filename — it never touches
   * a filesystem — but a clean name is what keeps it that way if storage ever
   * moves to disk or S3 keys.
   */
  private sanitizeFileName(raw: string): string {
    const base = raw.split(/[/\\]/).pop() ?? '';
    return base
      // eslint-disable-next-line no-control-regex
      .replace(/[ -]/g, '')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 255);
  }

  /** Map attachment rows to their view shape. Never exposes `data`. */
  static toViews(
    rows: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: Date;
      uploadedBy: { id: string; name: string };
    }>,
  ): CommentAttachmentView[] {
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedAt: a.uploadedAt.toISOString(),
      uploadedBy: { id: a.uploadedBy.id, name: a.uploadedBy.name },
    }));
  }
}

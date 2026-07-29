import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { AttachmentsService } from './attachments.service';

/**
 * Authenticated download of a review-comment attachment.
 *
 * Deliberately NOT tab-gated or @Roles-restricted at the edge: an attachment can
 * belong to either portal, so the authoritative check is the per-attachment scope
 * check inside AttachmentsService.download — it resolves the owning submission and
 * applies that submission's own clinic/department rule. Anyone who can see the
 * submission can see its proof; anyone who cannot gets a 403. Authentication
 * itself is enforced globally by the JWT guard, so there is no anonymous path to
 * a file.
 *
 * This route is a READ and writes no audit row.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get(':attachmentId/download')
  async download(
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachments.download(attachmentId, user);

    // Always a download, never a render: `attachment` disposition plus
    // nosniff means the browser cannot be talked into executing the bytes in
    // the app's origin, whatever the stored type claims.
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(file.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Uploaded proof must never be cached by a shared proxy — it is as sensitive
    // as the submission it belongs to.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(file.data);
  }
}

/**
 * A Content-Disposition header that survives non-ASCII filenames without letting
 * one break out of the header: the plain `filename` falls back to an ASCII-safe
 * form with quotes/backslashes/control characters stripped, and the RFC 5987
 * `filename*` carries the real UTF-8 name for browsers that understand it.
 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

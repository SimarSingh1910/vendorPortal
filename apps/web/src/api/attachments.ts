import { apiClient } from '@/lib/apiClient';

/**
 * Build the request body for a review action that may carry proof files.
 *
 * With no files this stays a plain JSON object, so the endpoints behave exactly
 * as they always have. With files it becomes multipart/form-data — the same
 * routes accept both, and the server treats the multipart text fields as the
 * ordinary DTO.
 */
export function reviewActionBody(
  fields: Record<string, string | undefined>,
  files: File[],
): FormData | Record<string, string> {
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''),
  ) as Record<string, string>;

  if (files.length === 0) return defined;

  const form = new FormData();
  for (const [key, value] of Object.entries(defined)) form.append(key, value);
  // Field name must match ATTACHMENT_FIELD on the server.
  for (const file of files) form.append('attachments', file, file.name);
  return form;
}

/**
 * Download an attachment through the AUTHENTICATED endpoint.
 *
 * Deliberately fetched as a blob via the API client (which carries the auth
 * header) rather than linked with a bare <a href> — the route requires a token,
 * and there is no public URL for an uploaded file. The blob URL created here is
 * same-origin, short-lived and revoked immediately after the click.
 */
export async function downloadAttachment(attachmentId: string, fileName: string): Promise<void> {
  const { data } = await apiClient.get<Blob>(`/attachments/${attachmentId}/download`, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(data);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Always a download, never a navigation — matches the server's
    // Content-Disposition: attachment.
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

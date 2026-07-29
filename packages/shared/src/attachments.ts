/**
 * Rules for files attached to a review comment as proof.
 *
 * The SERVER is the gate — AttachmentsService re-validates every one of these on
 * upload. They live here so the web app can mirror them for UX (an accept-filter
 * on the picker, an inline "too big" message before a doomed round-trip) without
 * the two drifting apart. A client that skips these checks entirely is rejected
 * by the API exactly the same way.
 */

/**
 * The ONLY content types accepted. Deliberately a closed allow-list, not a
 * block-list of "dangerous" types: proof is a document, an image or an email, and
 * anything else is a bug or an attack.
 *
 * Note what is absent and must stay absent — HTML and SVG (script-bearing, would
 * execute if ever rendered inline), and every executable/archive type. Downloads
 * are additionally served with Content-Disposition: attachment so nothing here is
 * rendered in the browsing context at all.
 *
 * Each MIME maps to the extensions allowed to carry it: BOTH must match, so a
 * `payload.html` renamed to `.pdf` (or a real PDF renamed to `.exe`) is rejected.
 */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  // Email-as-proof: RFC 822 (.eml) and Outlook (.msg). Browsers report .msg
  // inconsistently, so its common octet-stream spelling is accepted too — the
  // extension check still pins it down.
  'message/rfc822': ['.eml'],
  'application/vnd.ms-outlook': ['.msg'],
  'application/octet-stream': ['.msg'],
  'text/plain': ['.txt'],
};

/** Every extension the picker should offer, derived from the allow-list above. */
export const ALLOWED_ATTACHMENT_EXTENSIONS: readonly string[] = Array.from(
  new Set(Object.values(ALLOWED_ATTACHMENT_TYPES).flat()),
);

/**
 * Size and count caps.
 *
 * These are deliberately TIGHT because the bytes currently live in the database
 * (see the CommentAttachment model): a blob column is fine for demo-scale proof
 * files and bad for anything larger. Raising them meaningfully should come with
 * the move to object storage, not before.
 */
export const ATTACHMENT_LIMITS = {
  /** Per file. */
  maxFileBytes: 5 * 1024 * 1024, // 5 MB
  /** Per comment. */
  maxFiles: 5,
  /**
   * Across one upload — below maxFileBytes × maxFiles on purpose, so a single
   * request can't pin 25 MB of buffers per concurrent caller.
   */
  maxTotalBytes: 15 * 1024 * 1024, // 15 MB
} as const;

/** Human-readable size for UI and error messages ("4.2 MB", "812 KB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The lower-cased extension of a filename, including the dot ("" when none). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Is this MIME + filename pair allowed? Both must agree — see
 * ALLOWED_ATTACHMENT_TYPES. Used by the server as the gate and by the web app to
 * pre-empt an obviously doomed upload.
 */
export function isAllowedAttachment(mimeType: string, fileName: string): boolean {
  const extensions = ALLOWED_ATTACHMENT_TYPES[mimeType.toLowerCase()];
  if (!extensions) return false;
  return extensions.includes(fileExtension(fileName));
}

/** One attachment as shown in a comment thread. Never carries the file bytes. */
export interface CommentAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string; // ISO-8601
  uploadedBy: { id: string; name: string };
}

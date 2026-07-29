import { useRef, useState } from 'react';
import { Download, Paperclip, X } from 'lucide-react';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_LIMITS,
  formatFileSize,
  isAllowedAttachment,
  type CommentAttachmentView,
} from '@portal/shared';
import { Button } from '@/components/ui/button';
import { downloadAttachment } from '@/api/attachments';
import { formatIST } from '@/lib/format';

interface AttachPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * "Attach files" control beside a review comment box — proof for an override,
 * send-back or approval.
 *
 * Shared by BOTH portals (clinic manager/finance review and corporate review) so
 * the rules and the wording never diverge. The checks here are UX ONLY: they use
 * the same shared limits the server enforces, purely so the reviewer finds out
 * before a doomed upload. AttachmentsService is the actual gate.
 *
 * Files are editable only until the comment is submitted; afterwards they are
 * fixed (they are evidence), which is why removal exists here and nowhere else.
 */
export function AttachPicker({ files, onChange, disabled }: AttachPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePick = (picked: FileList | null) => {
    if (!picked) return;
    const incoming = Array.from(picked);
    const next = [...files];
    let problem: string | null = null;

    for (const file of incoming) {
      if (next.length >= ATTACHMENT_LIMITS.maxFiles) {
        problem = `You can attach at most ${ATTACHMENT_LIMITS.maxFiles} files.`;
        break;
      }
      if (!isAllowedAttachment(file.type, file.name)) {
        problem = `“${file.name}” isn’t an allowed file type (${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}).`;
        continue;
      }
      if (file.size > ATTACHMENT_LIMITS.maxFileBytes) {
        problem = `“${file.name}” is ${formatFileSize(file.size)} — the limit is ${formatFileSize(ATTACHMENT_LIMITS.maxFileBytes)} per file.`;
        continue;
      }
      if (file.size === 0) {
        problem = `“${file.name}” is empty.`;
        continue;
      }
      // Same name + size twice is almost certainly a double-pick, not two files.
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }

    const total = next.reduce((sum, f) => sum + f.size, 0);
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
      problem = `Attachments total ${formatFileSize(total)} — the limit is ${formatFileSize(ATTACHMENT_LIMITS.maxTotalBytes)} per comment.`;
    } else {
      onChange(next);
    }

    setError(problem);
    // Reset so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (index: number) => {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
        onChange={(e) => handlePick(e.target.files)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || files.length >= ATTACHMENT_LIMITS.maxFiles}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
          Attach files
        </Button>
        <span className="text-xs text-muted-foreground">
          Proof for this decision — PDF, image or email. Up to {ATTACHMENT_LIMITS.maxFiles} files,{' '}
          {formatFileSize(ATTACHMENT_LIMITS.maxFileBytes)} each.
        </span>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {files.length} file{files.length === 1 ? '' : 's'} · {formatFileSize(total)} — attached
          when you submit this comment, and fixed afterwards.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The attachments of an ALREADY-SAVED comment, as authenticated download links.
 *
 * There is no public URL for these: each click fetches the bytes through the
 * token-carrying API client, so a user who cannot see the submission cannot pull
 * its proof. Immutable — no remove control here by design.
 */
export function AttachmentList({ attachments }: { attachments: CommentAttachmentView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const download = async (a: CommentAttachmentView) => {
    setBusy(a.id);
    setError(null);
    try {
      await downloadAttachment(a.id, a.fileName);
    } catch {
      setError(`Could not download “${a.fileName}”.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      {attachments.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <Button
            type="button"
            variant="ghostPrimary"
            size="sm"
            className="h-7 gap-1.5 px-2"
            disabled={busy === a.id}
            onClick={() => void download(a)}
          >
            <Download className="size-3.5" />
            {a.fileName}
          </Button>
          <span className="text-muted-foreground">
            {formatFileSize(a.sizeBytes)} · {a.uploadedBy.name} · {formatIST(a.uploadedAt)}
          </span>
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { reminderKind, type DashboardStatusTile, type SendRemindersResult } from '@portal/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sendReminders } from '@/api/dashboard';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * Finance "Send reminder" for the clinics ticked in the status table: confirm, send,
 * then show what was sent and what was skipped (and why). The server enforces the
 * rules — who is emailed per status, and at most one reminder per clinic per day.
 */
export function SendReminderButton({
  tiles,
  selected,
  onDone,
}: {
  tiles: DashboardStatusTile[];
  /** Ticked submission ids (already limited to remindable rows). */
  selected: Set<string>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const picked = tiles.filter((t) => t.submissionId && selected.has(t.submissionId));
  const approvals = picked.filter((t) => reminderKind(t.status) === 'APPROVAL_PENDING').length;
  const submissions = picked.length - approvals;

  // Why the button is disabled, if it is.
  const hint =
    picked.length > 0
      ? undefined
      : tiles.some((t) => t.submissionId && reminderKind(t.status))
        ? 'Tick pending clinics in the Table view first'
        : 'No clinic is waiting on a submission or approval';

  const mutation = useMutation<SendRemindersResult, unknown, string[]>({
    mutationFn: sendReminders,
    // Settled, not success: a batch that fails part-way may still have sent some.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['dashboard', 'status'] }),
  });
  const result = mutation.data;

  const close = () => {
    if (mutation.isPending) return;
    setOpen(false);
    if (result) onDone();
    mutation.reset();
  };

  return (
    <>
      {/* The hint sits on a wrapper: a disabled button gets no hover events. */}
      <span title={hint}>
        <Button
          variant="outline"
          size="sm"
          disabled={picked.length === 0}
          onClick={() => setOpen(true)}
        >
          <BellRing />
          Send reminder{picked.length > 0 ? ` (${picked.length})` : ''}
        </Button>
      </span>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {result
                ? 'Reminders sent'
                : `Send reminders to ${picked.length} clinic${picked.length === 1 ? '' : 's'}?`}
            </DialogTitle>
            {!result && (
              <DialogDescription>
                An email (and in-app notification) goes out now. Clinics already reminded today are
                skipped.
              </DialogDescription>
            )}
          </DialogHeader>

          {!result ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {submissions > 0 && (
                <li>
                  {submissions} not submitted / sent back → their <b>Clinic SPOC</b> and{' '}
                  <b>cluster manager</b>
                </li>
              )}
              {approvals > 0 && (
                <li>
                  {approvals} waiting for approval → their <b>cluster manager</b>
                </li>
              )}
            </ul>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                Sent: <b>{result.sent.length}</b>
                {result.sent.length > 0 &&
                  ` (${result.sent.reduce((n, s) => n + s.recipients, 0)} notifications)`}
                {' · '}Skipped: <b>{result.skipped.length}</b>
              </p>
              {result.skipped.length > 0 && (
                <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-muted-foreground">
                  {result.skipped.map((s) => (
                    <li key={s.submissionId}>
                      {s.clinicName || s.submissionId}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {apiErrorMessage(mutation.error, 'Could not send reminders. Please try again.')}
            </p>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={close} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => mutation.mutate(picked.map((t) => t.submissionId!))}
                  disabled={mutation.isPending || picked.length === 0}
                >
                  {mutation.isPending ? 'Sending…' : 'Send reminders'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

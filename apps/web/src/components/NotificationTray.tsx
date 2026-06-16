import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth.store';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationStreamUrl,
  sendTestNotification,
} from '@/api/notifications';
import { formatIST } from '@/lib/format';
import { cn } from '@/lib/utils';

export function NotificationTray() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notifications'] });

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: listNotifications,
  });
  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: getUnreadCount,
  });

  // Live stream: re-establish whenever the access token changes (rotation).
  useEffect(() => {
    if (!token) return;
    const source = new EventSource(notificationStreamUrl(token));
    source.onmessage = () => invalidate();
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const markRead = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });
  const test = useMutation({ mutationFn: sendTestNotification, onSuccess: invalidate });

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative"
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              <div className="flex gap-2">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => test.mutate()}
                >
                  Send test
                </button>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => markAll.mutate()}
                  disabled={unread === 0}
                >
                  Mark all read
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-auto">
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No notifications.
                </p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.isRead && markRead.mutate(n.id)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent',
                      !n.isRead && 'bg-muted/40',
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-medium">{n.type}</span>
                      {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                    </span>
                    <span className="text-muted-foreground">{n.message}</span>
                    <span className="text-xs text-muted-foreground">{formatIST(n.createdAt)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

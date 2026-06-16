import type { NotificationView } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export async function listNotifications(): Promise<NotificationView[]> {
  const { data } = await apiClient.get<NotificationView[]>('/notifications');
  return data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>('/notifications/unread-count');
  return data.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post('/notifications/read-all');
}

export async function sendTestNotification(): Promise<NotificationView> {
  const { data } = await apiClient.post<NotificationView>('/notifications/test');
  return data;
}

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

/** SSE URL — token in the query because EventSource can't send headers. */
export function notificationStreamUrl(token: string): string {
  return `${baseURL}/notifications/stream?token=${encodeURIComponent(token)}`;
}

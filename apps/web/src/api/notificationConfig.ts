import type { NotificationConfigInput, NotificationConfigView } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export async function listConfigs(): Promise<NotificationConfigView[]> {
  const { data } = await apiClient.get<NotificationConfigView[]>('/notification-config');
  return data;
}

export async function upsertConfig(
  month: string,
  input: NotificationConfigInput,
): Promise<NotificationConfigView> {
  const { data } = await apiClient.put<NotificationConfigView>(`/notification-config/${month}`, input);
  return data;
}

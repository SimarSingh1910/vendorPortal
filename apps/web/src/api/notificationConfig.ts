import { PortalTab, type NotificationConfigInput, type NotificationConfigView } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export async function listConfigs(
  portal: PortalTab = PortalTab.CLINIC,
): Promise<NotificationConfigView[]> {
  const { data } = await apiClient.get<NotificationConfigView[]>('/notification-config', {
    params: { portal },
  });
  return data;
}

export async function upsertConfig(
  month: string,
  input: NotificationConfigInput,
  portal: PortalTab = PortalTab.CLINIC,
): Promise<NotificationConfigView> {
  const { data } = await apiClient.put<NotificationConfigView>(
    `/notification-config/${month}`,
    input,
    { params: { portal } },
  );
  return data;
}

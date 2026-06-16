import type { AuditLogPage } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export interface AuditFilter {
  clinicId?: string;
  performedById?: string;
  action?: string;
  from?: string; // ISO-8601
  to?: string; // ISO-8601
  page?: number;
  pageSize?: number;
}

/** Drop empty/undefined keys so axios doesn't send blank query params. */
function clean(filter: AuditFilter): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export async function searchAudit(filter: AuditFilter): Promise<AuditLogPage> {
  const { data } = await apiClient.get<AuditLogPage>('/audit', { params: clean(filter) });
  return data;
}

export async function getAuditActions(): Promise<string[]> {
  const { data } = await apiClient.get<string[]>('/audit/actions');
  return data;
}

/** Download the currently-filtered audit set as .xlsx (auth via the api client). */
export async function exportAudit(filter: AuditFilter): Promise<void> {
  const response = await apiClient.get('/audit/export', {
    params: clean(filter),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'audit-log.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

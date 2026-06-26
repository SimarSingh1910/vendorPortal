import type { ActiveFilter, CorpDepartment } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate department reads for the Finance Admin user-management screen, so a
 * Dept SPOC/Viewer can be mapped to one or more departments. Department master
 * CRUD lives behind /corp/departments (Finance Admin + Corporate tab).
 */
export async function listDepartments(status: ActiveFilter): Promise<CorpDepartment[]> {
  const { data } = await apiClient.get<CorpDepartment[]>('/corp/departments', {
    params: { status },
  });
  return data;
}

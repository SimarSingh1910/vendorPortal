import type { ActiveFilter, CorpDepartment, CorpDepartmentType } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate department master data (Step C1.1, admin UI → CF.3). Finance-Admin +
 * Corporate tab behind /corp/departments. The list read is also used by the
 * user-management screen (map a Dept SPOC/Viewer to departments).
 */
export interface CorpDepartmentInput {
  name: string;
  type: CorpDepartmentType;
}

export async function listDepartments(status: ActiveFilter): Promise<CorpDepartment[]> {
  const { data } = await apiClient.get<CorpDepartment[]>('/corp/departments', {
    params: { status },
  });
  return data;
}

export async function getDepartment(id: string): Promise<CorpDepartment> {
  const { data } = await apiClient.get<CorpDepartment>(`/corp/departments/${id}`);
  return data;
}

export async function createDepartment(input: CorpDepartmentInput): Promise<CorpDepartment> {
  const { data } = await apiClient.post<CorpDepartment>('/corp/departments', input);
  return data;
}

export async function updateDepartment(
  id: string,
  input: CorpDepartmentInput,
): Promise<CorpDepartment> {
  const { data } = await apiClient.patch<CorpDepartment>(`/corp/departments/${id}`, input);
  return data;
}

export async function setDepartmentActive(
  id: string,
  isActive: boolean,
): Promise<CorpDepartment> {
  const { data } = await apiClient.patch<CorpDepartment>(
    `/corp/departments/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

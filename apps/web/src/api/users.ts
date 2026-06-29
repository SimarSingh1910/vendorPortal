import type { ActiveFilter, AdminUser, PortalTab, UserRole } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  clinicIds: string[];
  departmentIds: string[];
}

export interface UpdateUserInput {
  name: string;
  role: UserRole;
  clinicIds: string[];
  departmentIds: string[];
  password?: string; // omitted = keep current password
}

export async function listUsers(status: ActiveFilter, portal?: PortalTab): Promise<AdminUser[]> {
  const { data } = await apiClient.get<AdminUser[]>('/users', {
    params: { status, ...(portal ? { portal } : {}) },
  });
  return data;
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const { data } = await apiClient.post<AdminUser>('/users', input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<AdminUser> {
  const { data } = await apiClient.patch<AdminUser>(`/users/${id}`, input);
  return data;
}

export async function setUserActive(id: string, isActive: boolean): Promise<AdminUser> {
  const { data } = await apiClient.patch<AdminUser>(
    `/users/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

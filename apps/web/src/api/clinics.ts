import type { ActiveFilter, Clinic } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export interface ClinicInput {
  name: string;
  location: string;
  corporateClient: string;
}

export async function listClinics(status: ActiveFilter): Promise<Clinic[]> {
  const { data } = await apiClient.get<Clinic[]>('/clinics', { params: { status } });
  return data;
}

export async function createClinic(input: ClinicInput): Promise<Clinic> {
  const { data } = await apiClient.post<Clinic>('/clinics', input);
  return data;
}

export async function updateClinic(id: string, input: ClinicInput): Promise<Clinic> {
  const { data } = await apiClient.patch<Clinic>(`/clinics/${id}`, input);
  return data;
}

export async function setClinicActive(id: string, isActive: boolean): Promise<Clinic> {
  const { data } = await apiClient.patch<Clinic>(
    `/clinics/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

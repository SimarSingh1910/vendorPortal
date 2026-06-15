import type { MappedExpenseHead } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/** Heads that currently apply to a clinic (active mapping + active head). */
export async function getMappedHeads(clinicId: string): Promise<MappedExpenseHead[]> {
  const { data } = await apiClient.get<MappedExpenseHead[]>(`/clinics/${clinicId}/expense-heads`);
  return data;
}

/** Set the exact active mapping set for a clinic. */
export async function setMappings(
  clinicId: string,
  expenseHeadIds: string[],
): Promise<MappedExpenseHead[]> {
  const { data } = await apiClient.put<MappedExpenseHead[]>(`/clinics/${clinicId}/expense-heads`, {
    expenseHeadIds,
  });
  return data;
}

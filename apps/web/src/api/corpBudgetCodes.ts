import type { ActiveFilter } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate budget-code master data (Step C1.2, admin UI → CF.3). Codes are
 * dept-specific and unique within their department (BR-C01), so every route is
 * nested under a department. Finance Admin + Corporate tab.
 */
export interface CorpBudgetCodeRow {
  id: string;
  departmentId: string;
  code: string;
  description: string | null;
  isActive: boolean;
}

export interface CorpBudgetCodeInput {
  code: string;
  description?: string;
}

const base = (departmentId: string) => `/corp/departments/${departmentId}/budget-codes`;

export async function listCorpBudgetCodes(
  departmentId: string,
  status: ActiveFilter,
): Promise<CorpBudgetCodeRow[]> {
  const { data } = await apiClient.get<CorpBudgetCodeRow[]>(base(departmentId), {
    params: { status },
  });
  return data;
}

export async function createCorpBudgetCode(
  departmentId: string,
  input: CorpBudgetCodeInput,
): Promise<CorpBudgetCodeRow> {
  const { data } = await apiClient.post<CorpBudgetCodeRow>(base(departmentId), input);
  return data;
}

export async function updateCorpBudgetCode(
  departmentId: string,
  id: string,
  input: CorpBudgetCodeInput,
): Promise<CorpBudgetCodeRow> {
  const { data } = await apiClient.patch<CorpBudgetCodeRow>(`${base(departmentId)}/${id}`, input);
  return data;
}

export async function setCorpBudgetCodeActive(
  departmentId: string,
  id: string,
  isActive: boolean,
): Promise<CorpBudgetCodeRow> {
  const { data } = await apiClient.patch<CorpBudgetCodeRow>(
    `${base(departmentId)}/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

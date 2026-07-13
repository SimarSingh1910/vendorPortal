import type { ActiveFilter } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate expense-head master data (Step C1.1, admin UI → CF.3). Heads are
 * dept-specific (BR-C09), so every route is nested under a department. Finance
 * Admin + Corporate tab. No shared view type exists; the rows are the service's
 * Prisma shape, captured here.
 */
export interface CorpExpenseHeadRow {
  id: string;
  departmentId: string;
  name: string;
  isActive: boolean;
}

export interface CorpExpenseHeadInput {
  name: string;
}

const base = (departmentId: string) => `/corp/departments/${departmentId}/expense-heads`;

export async function listCorpExpenseHeads(
  departmentId: string,
  status: ActiveFilter,
): Promise<CorpExpenseHeadRow[]> {
  const { data } = await apiClient.get<CorpExpenseHeadRow[]>(base(departmentId), {
    params: { status },
  });
  return data;
}

export async function createCorpExpenseHead(
  departmentId: string,
  input: CorpExpenseHeadInput,
): Promise<CorpExpenseHeadRow> {
  const { data } = await apiClient.post<CorpExpenseHeadRow>(base(departmentId), input);
  return data;
}

export async function updateCorpExpenseHead(
  departmentId: string,
  id: string,
  input: CorpExpenseHeadInput,
): Promise<CorpExpenseHeadRow> {
  const { data } = await apiClient.patch<CorpExpenseHeadRow>(`${base(departmentId)}/${id}`, input);
  return data;
}

export async function setCorpExpenseHeadActive(
  departmentId: string,
  id: string,
  isActive: boolean,
): Promise<CorpExpenseHeadRow> {
  const { data } = await apiClient.patch<CorpExpenseHeadRow>(
    `${base(departmentId)}/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

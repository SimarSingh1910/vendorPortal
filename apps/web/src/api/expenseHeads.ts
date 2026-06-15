import type { ActiveFilter, ExpenseHead } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export interface ExpenseHeadInput {
  name: string;
  category: string;
}

export async function listExpenseHeads(status: ActiveFilter): Promise<ExpenseHead[]> {
  const { data } = await apiClient.get<ExpenseHead[]>('/expense-heads', { params: { status } });
  return data;
}

export async function createExpenseHead(input: ExpenseHeadInput): Promise<ExpenseHead> {
  const { data } = await apiClient.post<ExpenseHead>('/expense-heads', input);
  return data;
}

export async function updateExpenseHead(id: string, input: ExpenseHeadInput): Promise<ExpenseHead> {
  const { data } = await apiClient.patch<ExpenseHead>(`/expense-heads/${id}`, input);
  return data;
}

export async function setExpenseHeadActive(id: string, isActive: boolean): Promise<ExpenseHead> {
  const { data } = await apiClient.patch<ExpenseHead>(
    `/expense-heads/${id}/${isActive ? 'activate' : 'deactivate'}`,
  );
  return data;
}

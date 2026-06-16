import type {
  ClinicMonthStatus,
  ProvisionEntryInput,
  SubmissionCommentView,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionStatus,
} from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/** Per-accessible-clinic status for a month (defaults to current IST month). */
export async function getOverview(month?: string): Promise<ClinicMonthStatus[]> {
  const { data } = await apiClient.get<ClinicMonthStatus[]>('/submissions', {
    params: month ? { month } : undefined,
  });
  return data;
}

/** A clinic's submission history, optionally filtered by status. */
export async function getClinicHistory(
  clinicId: string,
  status?: SubmissionStatus,
): Promise<SubmissionListItem[]> {
  const { data } = await apiClient.get<SubmissionListItem[]>('/submissions', {
    params: { clinicId, ...(status ? { status } : {}) },
  });
  return data;
}

export async function getSubmission(submissionId: string): Promise<SubmissionDetail> {
  const { data } = await apiClient.get<SubmissionDetail>(`/submissions/${submissionId}`);
  return data;
}

export async function saveEntries(
  submissionId: string,
  entries: ProvisionEntryInput[],
): Promise<SubmissionDetail> {
  const { data } = await apiClient.put<SubmissionDetail>(`/submissions/${submissionId}/entries`, {
    entries,
  });
  return data;
}

export async function submitSubmission(submissionId: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/submit`);
}

export async function getComments(submissionId: string): Promise<SubmissionCommentView[]> {
  const { data } = await apiClient.get<SubmissionCommentView[]>(
    `/submissions/${submissionId}/comments`,
  );
  return data;
}

/** The caller's cross-clinic work queue for the given statuses (Manager/Finance). */
export async function getQueue(statuses: SubmissionStatus[]): Promise<SubmissionListItem[]> {
  const { data } = await apiClient.get<SubmissionListItem[]>('/submissions', {
    params: { status: statuses.join(',') },
  });
  return data;
}

// ── Manager workflow transitions ─────────────────────────────────────────────

export async function managerOpenReview(submissionId: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/manager/open`);
}

export async function managerApprove(submissionId: string, comment?: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/manager/approve`, comment ? { comment } : {});
}

export async function managerSendBack(submissionId: string, comment: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/manager/send-back`, { comment });
}

// ── Finance workflow transitions ─────────────────────────────────────────────

export async function financeOpenReview(submissionId: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/finance/open`);
}

export async function financeApprove(submissionId: string, comment?: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/finance/approve`, comment ? { comment } : {});
}

export async function financeSendBack(submissionId: string, comment: string): Promise<void> {
  await apiClient.post(`/submissions/${submissionId}/finance/send-back`, { comment });
}

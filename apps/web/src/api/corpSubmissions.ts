import type {
  CorpDepartmentMonthStatus,
  CorpProvisionEntryInput,
  CorpSubmissionDetail,
  CorpSubmissionListItem,
  SubmissionCommentView,
} from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate submission workflow client (Phase C2). Mirrors the clinic
 * `api/submissions.ts` shape — bare async functions over `apiClient` — against the
 * `/corp/*` surface. Department scoping, role gating, lock/state rules and audit
 * all live in the backend; this layer only shuttles typed payloads.
 */

// ── Reads ────────────────────────────────────────────────────────────────────

/** SPOC/Viewer home: each accessible department's status for the month. */
export async function getCorpOverview(month: string): Promise<CorpDepartmentMonthStatus[]> {
  const { data } = await apiClient.get<CorpDepartmentMonthStatus[]>('/corp/overview', {
    params: { month },
  });
  return data;
}

/** Approver review queue: every dept's SUBMITTED / in-review item, oldest first. */
export async function getCorpReviewQueue(month?: string): Promise<CorpSubmissionListItem[]> {
  const { data } = await apiClient.get<CorpSubmissionListItem[]>('/corp/review/queue', {
    params: month ? { month } : undefined,
  });
  return data;
}

/** A department's submission history. */
export async function getCorpDepartmentHistory(
  departmentId: string,
  month?: string,
): Promise<CorpSubmissionListItem[]> {
  const { data } = await apiClient.get<CorpSubmissionListItem[]>(
    `/corp/departments/${departmentId}/submissions`,
    { params: month ? { month } : undefined },
  );
  return data;
}

export async function getCorpSubmission(submissionId: string): Promise<CorpSubmissionDetail> {
  const { data } = await apiClient.get<CorpSubmissionDetail>(`/corp/submissions/${submissionId}`);
  return data;
}

export async function getCorpComments(submissionId: string): Promise<SubmissionCommentView[]> {
  const { data } = await apiClient.get<SubmissionCommentView[]>(
    `/corp/submissions/${submissionId}/comments`,
  );
  return data;
}

// ── Entry (SPOC draft / approver override) ───────────────────────────────────

/**
 * Save a partial draft: each line carries BOTH a budget code and an amount
 * (BR-C01). Incomplete lines are simply omitted from the array by the caller,
 * never sent with a missing field. Returns the refreshed detail.
 */
export async function saveCorpEntries(
  submissionId: string,
  entries: CorpProvisionEntryInput[],
): Promise<CorpSubmissionDetail> {
  const { data } = await apiClient.put<CorpSubmissionDetail>(
    `/corp/submissions/${submissionId}/entries`,
    { entries },
  );
  return data;
}

// ── Workflow transitions ─────────────────────────────────────────────────────

/** SPOC: submit for review (every head must have a budget code AND value). */
export async function submitCorpSubmission(submissionId: string, comment?: string): Promise<void> {
  const trimmed = comment?.trim();
  await apiClient.post(
    `/corp/submissions/${submissionId}/submit`,
    trimmed ? { comment: trimmed } : {},
  );
}

/** Approver: open review on a SUBMITTED item (stamps who/when). */
export async function corpOpenReview(submissionId: string): Promise<void> {
  await apiClient.post(`/corp/submissions/${submissionId}/review/open`);
}

export async function corpApprove(submissionId: string, comment?: string): Promise<void> {
  const trimmed = comment?.trim();
  await apiClient.post(
    `/corp/submissions/${submissionId}/review/approve`,
    trimmed ? { comment: trimmed } : {},
  );
}

export async function corpSendBack(submissionId: string, comment: string): Promise<void> {
  await apiClient.post(`/corp/submissions/${submissionId}/review/send-back`, { comment });
}

/** Finance Admin only: unlock an approved (locked) submission with a mandatory reason. */
export async function corpUnlock(submissionId: string, reason: string): Promise<void> {
  await apiClient.post(`/corp/submissions/${submissionId}/unlock`, { reason });
}

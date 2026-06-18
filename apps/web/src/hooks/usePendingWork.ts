import { useQuery } from '@tanstack/react-query';
import { isActionPending, SubmissionStatus, UserRole } from '@portal/shared';
import { getOverview, getQueue } from '@/api/submissions';
import { useAuthStore } from '@/store/auth.store';

/**
 * How many current items the signed-in user still needs to act on (Step 6).
 *
 * Reuses the EXACT query keys of the role's home screen so React Query serves
 * the same cache — no extra request. Read-only roles always get 0. The flag is
 * derived purely from status + role, so it clears on its own as work advances.
 */

const MANAGER_QUEUE = [SubmissionStatus.SUBMITTED, SubmissionStatus.CLINIC_MANAGER_REVIEW];
const FINANCE_QUEUE = [SubmissionStatus.CLINIC_APPROVED, SubmissionStatus.FINANCE_REVIEW];

export function usePendingWork(): number {
  const role = useAuthStore((s) => s.user?.role);

  const isSpoc = role === UserRole.CLINIC_SPOC;
  const isManager = role === UserRole.CLINIC_MANAGER;
  const isFinance = role === UserRole.FINANCE_ADMIN || role === UserRole.FINANCE_MANAGER;

  const overview = useQuery({
    queryKey: ['submissions', 'overview'],
    queryFn: () => getOverview(),
    enabled: isSpoc,
  });
  const managerQueue = useQuery({
    queryKey: ['submissions', 'queue', 'manager'],
    queryFn: () => getQueue(MANAGER_QUEUE),
    enabled: isManager,
  });
  const financeQueue = useQuery({
    queryKey: ['submissions', 'queue', 'finance'],
    queryFn: () => getQueue(FINANCE_QUEUE),
    enabled: isFinance,
  });

  if (!role) return 0;

  if (isSpoc) {
    // Only count clinics whose cycle is actually open (a submission exists).
    return (overview.data ?? []).filter(
      (row) => row.submissionId && isActionPending(role, row.status),
    ).length;
  }
  if (isManager) {
    return (managerQueue.data ?? []).filter((item) => isActionPending(role, item.status)).length;
  }
  if (isFinance) {
    return (financeQueue.data ?? []).filter((item) => isActionPending(role, item.status)).length;
  }
  return 0;
}

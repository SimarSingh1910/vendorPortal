import { useQuery } from '@tanstack/react-query';
import { isCorpActionPending, UserRole } from '@portal/shared';
import { getCorpOverview, getCorpReviewQueue } from '@/api/corpSubmissions';
import { useAuthStore } from '@/store/auth.store';
import { currentMonthIST } from '@/lib/corpFormat';

/**
 * How many current corporate items the signed-in user still needs to act on —
 * the corporate-tab parallel of usePendingWork (which is clinic-only).
 *
 * Reuses the EXACT query keys of the corporate home screens so React Query
 * serves the same cache — no extra request:
 *   DEPT_SPOC            → ['corp','overview', month]  (CorporateHome)
 *   approver (CORP_FINANCE_MANAGER / FINANCE_ADMIN) → ['corp','queue']  (CorpReviewQueue)
 * Read-only DEPT_VIEWER (and clinic roles) always get 0. The flag is derived
 * purely from status + role, so it clears itself as work advances.
 */
export function useCorpPendingWork(): number {
  const role = useAuthStore((s) => s.user?.role);

  const isSpoc = role === UserRole.DEPT_SPOC;
  const isApprover = role === UserRole.FINANCE_ADMIN || role === UserRole.CORP_FINANCE_MANAGER;
  const month = currentMonthIST();

  const overview = useQuery({
    queryKey: ['corp', 'overview', month],
    queryFn: () => getCorpOverview(month),
    enabled: isSpoc,
  });
  const queue = useQuery({
    queryKey: ['corp', 'queue'],
    queryFn: () => getCorpReviewQueue(),
    enabled: isApprover,
  });

  if (!role) return 0;

  if (isSpoc) {
    // Only count departments whose cycle is actually open (a submission exists).
    return (overview.data ?? []).filter(
      (row) => row.submissionId && isCorpActionPending(role, row.status),
    ).length;
  }
  if (isApprover) {
    return (queue.data ?? []).filter((item) => isCorpActionPending(role, item.status)).length;
  }
  return 0;
}

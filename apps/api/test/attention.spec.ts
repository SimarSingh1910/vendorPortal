/**
 * Unit tests for the role-aware "action needed" derivation (Iteration 2 / Step 6).
 *
 * Pure logic from @portal/shared — no DB, no Nest module. Asserts the full
 * role × status matrix and, crucially, that the pending flag CLEARS on its own
 * once the state machine advances past the acting role's window.
 */
import { isActionPending, pendingCount, SubmissionStatus, UserRole } from '@portal/shared';

const ALL_STATUSES = Object.values(SubmissionStatus);

/** Build the expected pending set for a role from the explicit status list. */
function expectPendingSet(role: UserRole, pending: SubmissionStatus[]): void {
  for (const status of ALL_STATUSES) {
    expect({ role, status, pending: isActionPending(role, status) }).toEqual({
      role,
      status,
      pending: pending.includes(status),
    });
  }
}

describe('isActionPending', () => {
  it('CLINIC_SPOC is pending only while entry is owed, and clears at SUBMITTED+', () => {
    expectPendingSet(UserRole.CLINIC_SPOC, [
      SubmissionStatus.NOT_STARTED,
      SubmissionStatus.DRAFT,
      SubmissionStatus.SENT_BACK_BY_MANAGER,
      SubmissionStatus.SENT_BACK_BY_FINANCE,
    ]);
    // Explicit "clears" checks once it leaves the SPOC's hands.
    expect(isActionPending(UserRole.CLINIC_SPOC, SubmissionStatus.SUBMITTED)).toBe(false);
    expect(isActionPending(UserRole.CLINIC_SPOC, SubmissionStatus.FINANCE_APPROVED)).toBe(false);
  });

  it('CLINIC_MANAGER is pending for SUBMITTED + review, and clears at CLINIC_APPROVED', () => {
    expectPendingSet(UserRole.CLINIC_MANAGER, [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.CLINIC_MANAGER_REVIEW,
    ]);
    expect(isActionPending(UserRole.CLINIC_MANAGER, SubmissionStatus.CLINIC_APPROVED)).toBe(false);
  });

  it('FINANCE_MANAGER is pending for clinic-approved + finance review, clears at FINANCE_APPROVED', () => {
    expectPendingSet(UserRole.FINANCE_MANAGER, [
      SubmissionStatus.CLINIC_APPROVED,
      SubmissionStatus.FINANCE_REVIEW,
    ]);
    expect(isActionPending(UserRole.FINANCE_MANAGER, SubmissionStatus.FINANCE_APPROVED)).toBe(false);
  });

  it('FINANCE_ADMIN matches FINANCE_MANAGER for every status', () => {
    for (const status of ALL_STATUSES) {
      expect(isActionPending(UserRole.FINANCE_ADMIN, status)).toBe(
        isActionPending(UserRole.FINANCE_MANAGER, status),
      );
    }
  });

  it('CLINIC_VIEWER (read-only) is never pending', () => {
    expectPendingSet(UserRole.CLINIC_VIEWER, []);
  });

  it('the terminal FINANCE_APPROVED state is pending for no role', () => {
    for (const role of Object.values(UserRole)) {
      expect(isActionPending(role, SubmissionStatus.FINANCE_APPROVED)).toBe(false);
    }
  });
});

describe('pendingCount', () => {
  it('counts only the statuses awaiting the given role', () => {
    const queue = [
      SubmissionStatus.SUBMITTED, // manager-pending
      SubmissionStatus.CLINIC_MANAGER_REVIEW, // manager-pending
      SubmissionStatus.CLINIC_APPROVED, // finance-pending, not manager
    ];
    expect(pendingCount(UserRole.CLINIC_MANAGER, queue)).toBe(2);
    expect(pendingCount(UserRole.FINANCE_MANAGER, queue)).toBe(1);
    expect(pendingCount(UserRole.CLINIC_VIEWER, queue)).toBe(0);
  });

  it('is zero for an empty list', () => {
    expect(pendingCount(UserRole.CLINIC_SPOC, [])).toBe(0);
  });
});

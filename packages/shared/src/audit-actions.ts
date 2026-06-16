/**
 * Canonical audit-action names. Centralised so call sites and the viewer's
 * filter share one vocabulary instead of scattered string literals.
 *
 * Submission workflow transitions are recorded dynamically as
 * `SUBMISSION_<ACTION>` (e.g. SUBMISSION_SUBMIT) by the state machine and are
 * intentionally not enumerated here.
 */
export const AuditAction = {
  CYCLE_OPEN: 'CYCLE_OPEN',

  PROVISION_SAVE: 'PROVISION_SAVE',
  PROVISION_EDIT_OVERRIDE: 'PROVISION_EDIT_OVERRIDE',
  UNLOCK: 'UNLOCK',

  CLINIC_CREATE: 'CLINIC_CREATE',
  CLINIC_UPDATE: 'CLINIC_UPDATE',
  CLINIC_SET_ACTIVE: 'CLINIC_SET_ACTIVE',
  CLINIC_MAPPINGS_SET: 'CLINIC_MAPPINGS_SET',

  EXPENSE_HEAD_CREATE: 'EXPENSE_HEAD_CREATE',
  EXPENSE_HEAD_UPDATE: 'EXPENSE_HEAD_UPDATE',
  EXPENSE_HEAD_SET_ACTIVE: 'EXPENSE_HEAD_SET_ACTIVE',

  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_SET_ACTIVE: 'USER_SET_ACTIVE',

  NOTIFICATION_CONFIG_CREATE: 'NOTIFICATION_CONFIG_CREATE',
  NOTIFICATION_CONFIG_UPDATE: 'NOTIFICATION_CONFIG_UPDATE',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

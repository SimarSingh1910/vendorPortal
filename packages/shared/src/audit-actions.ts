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
  /** Clinic-manager value override during their review stage (mirrors finance's
   * PROVISION_EDIT_OVERRIDE; records old->new, actor, clinicId). */
  MANAGER_PROVISION_OVERRIDE: 'MANAGER_PROVISION_OVERRIDE',
  UNLOCK: 'UNLOCK',
  /**
   * SPOC recalls/revokes their own not-yet-finalized submission back to DRAFT.
   * The one SUBMISSION_<ACTION> transition enumerated here (the rest are dynamic):
   * the engine stamps this exact name so the viewer can filter recalls.
   */
  SUBMISSION_RECALLED: 'SUBMISSION_RECALLED',

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

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

  // Corporate Provisions masters (Corporate tab). Departments and their
  // dept-specific expense heads are Finance-Admin CRUD; every mutation records
  // one row. Corporate masters are NOT clinic-scoped, so their audit rows carry
  // no clinicId.
  CORP_DEPARTMENT_CREATE: 'CORP_DEPARTMENT_CREATE',
  CORP_DEPARTMENT_UPDATE: 'CORP_DEPARTMENT_UPDATE',
  CORP_DEPARTMENT_SET_ACTIVE: 'CORP_DEPARTMENT_SET_ACTIVE',

  CORP_EXPENSE_HEAD_CREATE: 'CORP_EXPENSE_HEAD_CREATE',
  CORP_EXPENSE_HEAD_UPDATE: 'CORP_EXPENSE_HEAD_UPDATE',
  CORP_EXPENSE_HEAD_SET_ACTIVE: 'CORP_EXPENSE_HEAD_SET_ACTIVE',

  CORP_BUDGET_CODE_CREATE: 'CORP_BUDGET_CODE_CREATE',
  CORP_BUDGET_CODE_UPDATE: 'CORP_BUDGET_CODE_UPDATE',
  CORP_BUDGET_CODE_SET_ACTIVE: 'CORP_BUDGET_CODE_SET_ACTIVE',

  // Corporate cycle open (Step C2.1). Mirrors the clinic CYCLE_OPEN but for a
  // department/month; recorded as SYSTEM (no actor) when the scheduler opens it,
  // or with the admin actor on a manual open. Corp submissions are not
  // clinic-scoped, so these rows carry no clinicId.
  CORP_CYCLE_OPEN: 'CORP_CYCLE_OPEN',

  // Corporate provision entry + review (Phase C2). CORP_PROVISION_SAVE = a dept
  // SPOC's value save; CORP_PROVISION_EDIT_OVERRIDE = a corporate approver's
  // value edit during SUBMITTED/REVIEW (BR-C08, records old->new);
  // CORP_UNLOCK = a Finance-Admin unlock of an approved (locked) submission with
  // its mandatory reason. Corporate workflow TRANSITIONS are recorded dynamically
  // as `CORP_SUBMISSION_<ACTION>` (mirroring the clinic SUBMISSION_<ACTION>) and
  // are intentionally not enumerated here.
  CORP_PROVISION_SAVE: 'CORP_PROVISION_SAVE',
  CORP_PROVISION_EDIT_OVERRIDE: 'CORP_PROVISION_EDIT_OVERRIDE',
  CORP_UNLOCK: 'CORP_UNLOCK',

  // Sec 24 shared-cost-pool allocation % (Step C3.1). APPEND-ONLY (BR-C06): every
  // change is a new sec24_allocation_config row, so the audit records the before
  // (previously-effective %) and after for each set. Not department-scoped (one
  // global pool), so the row carries no clinicId.
  CORP_SEC24_PCT_SET: 'CORP_SEC24_PCT_SET',

  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_SET_ACTIVE: 'USER_SET_ACTIVE',

  NOTIFICATION_CONFIG_CREATE: 'NOTIFICATION_CONFIG_CREATE',
  NOTIFICATION_CONFIG_UPDATE: 'NOTIFICATION_CONFIG_UPDATE',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

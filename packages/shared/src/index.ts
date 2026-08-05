// Explicit named re-exports (not `export *`): TypeScript compiles `export *`
// to a dynamic `__exportStar` copy whose names bundlers like Rollup/Vite cannot
// statically detect, breaking named imports in the web app. Listing names keeps
// the CJS output statically analyzable for both Nest (tsc) and Vite (rollup).
export {
  UserRole,
  PortalTab,
  SubmissionStatus,
  CorpDepartmentType,
  CorpSubmissionStatus,
  FINANCE_ROLES,
  CLINIC_ROLES,
  CORPORATE_ROLES,
  DEPT_SCOPED_ROLES,
  ROLE_TABS,
  tabsForRole,
  roleCanAccessTab,
  rolesForTab,
  ROLE_LABELS,
  TAB_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_FILTER_OPTIONS,
  statusesSharingLabel,
} from './enums';

export {
  AuditAction,
  CORP_AUDIT_ACTION_PREFIX,
  isCorpAuditAction,
  auditActionPortal,
} from './audit-actions';

export { isActionPending, pendingCount } from './attention';

export { isCorpActionPending, corpPendingCount } from './corp-attention';

// Runtime constants from types.ts (values, not types).
export { MONTHWISE_PRESETS, DEFAULT_MONTHWISE_PRESET } from './types';

export { PRODUCT_CODES, PRODUCT_CODE_DESCRIPTIONS, productCodeLabel } from './product-codes';
export type { ProductCode } from './product-codes';

// Review-comment attachments (proof for overrides / send-backs). The server is
// the gate; these are shared so the web can mirror the same rules for UX.
export {
  ALLOWED_ATTACHMENT_TYPES,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_LIMITS,
  formatFileSize,
  fileExtension,
  isAllowedAttachment,
} from './attachments';
export type { CommentAttachmentView } from './attachments';

// Fixed-decimal maths for particulars (rate × quantity) and the derived sums
// above them — shared so the web's live preview and the server's stored figure
// are produced by the same code.
export {
  RATE_DECIMALS,
  QUANTITY_DECIMALS,
  VALUE_DECIMALS,
  MAX_VALUE_MINOR,
  toMinorUnits,
  minorToDecimalString,
  computeValueMinor,
  sumMinor,
  decimalStringToMinor,
} from './particular-math';

export type {
  HealthResponse,
  JwtClaims,
  ApiError,
  AuthUser,
  AuthTokens,
  AuthResponse,
  Clinic,
  ExpenseHead,
  ClinicExpenseHead,
  ActiveFilter,
  CorpDepartment,
  CorpProvisionEntryInput,
  CorpDepartmentMonthStatus,
  CorpSubmissionListItem,
  CorpBudgetCodeOption,
  CorpProvisionHeadRow,
  CorpSubmissionDetail,
  Sec24AllocationConfigView,
  Sec24AllocationInput,
  CorpDashboardStatusTile,
  CorpMonthlyTotalPoint,
  CorpDeptMonthlyTotalPoint,
  CorpHeadTrendPoint,
  CorpDepartmentTotalPoint,
  CorpSec24MonthPoint,
  CorpDashboardFilterOptions,
  MappedExpenseHead,
  AdminUser,
  SubmissionCommentAction,
  SubmissionCommentView,
  ClinicMonthStatus,
  SubmissionListItem,
  ProvisionHeadRow,
  ProvisionLine,
  ProvisionParticular,
  ProvisionParticularInput,
  SubmissionDetail,
  ProvisionEntryInput,
  ProvisionLineInput,
  AuditLogView,
  AuditLogPage,
  NotificationConfigView,
  NotificationConfigInput,
  NotificationView,
  DashboardStatusTile,
  MonthlyTotalPoint,
  HeadTrendPoint,
  HeadVendorTrendPoint,
  ClinicTotalPoint,
  VarianceRow,
  VarianceReport,
  DashboardFilterOptions,
  MonthwisePreset,
  MonthwiseReportRow,
  MonthwiseReport,
} from './types';

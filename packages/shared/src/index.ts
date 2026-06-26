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
  ROLE_LABELS,
  TAB_LABELS,
  SUBMISSION_STATUS_LABELS,
} from './enums';

export { AuditAction } from './audit-actions';

export { isActionPending, pendingCount } from './attention';

// Runtime constants from types.ts (values, not types).
export { MONTHWISE_PRESETS, DEFAULT_MONTHWISE_PRESET } from './types';

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
  MappedExpenseHead,
  AdminUser,
  SubmissionCommentAction,
  SubmissionCommentView,
  ClinicMonthStatus,
  SubmissionListItem,
  ProvisionHeadRow,
  SubmissionDetail,
  ProvisionEntryInput,
  AuditLogView,
  AuditLogPage,
  NotificationConfigView,
  NotificationConfigInput,
  NotificationView,
  DashboardStatusTile,
  MonthlyTotalPoint,
  HeadTrendPoint,
  ClinicTotalPoint,
  VarianceRow,
  VarianceReport,
  DashboardFilterOptions,
  MonthwisePreset,
  MonthwiseReportRow,
  MonthwiseReport,
} from './types';

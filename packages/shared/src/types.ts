/**
 * Cross-cutting types shared between the API and the web client.
 *
 * Domain entity contracts (User, Clinic, ExpenseHead, Submission, ...) will be
 * added alongside the Prisma schema in a later step. For now this holds the
 * primitives that the scaffolding needs — health responses and the JWT claim
 * shape that RBAC will rely on.
 */

import type { SubmissionStatus, UserRole } from './enums';

/** Response from the API health endpoint. */
export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string; // ISO-8601, UTC
}

/**
 * Decoded JWT access-token claims.
 * `clinicIds` scopes clinic-bound roles; empty/undefined for Finance roles.
 */
export interface JwtClaims {
  sub: string; // user id
  email: string;
  role: UserRole;
  clinicIds?: string[];
  // Snapshot of the user's tokenVersion at issue time. The RBAC guard rejects a
  // token whose value no longer matches the user's current tokenVersion, giving
  // immediate revocation on role change / deactivation / forced logout.
  tokenVersion: number;
}

/** Authenticated user identity returned to the client on login/refresh. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  clinicIds: string[];
}

/** Token pair issued internally by the API (refresh travels in an httpOnly cookie). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Response body for /auth/login and /auth/refresh. The refresh token is NOT in
 * the body — the API sets it as an httpOnly, SameSite cookie (Phase 13.1), so it
 * is never readable by JS. The client keeps only the access token (in memory).
 */
export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

// ── User & access management (Phase 4) ───────────────────────────────────────

/**
 * A user as shown in the Finance Admin user-management screen. Never includes
 * the password hash. `clinicIds` is populated only for clinic-scoped roles.
 */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  clinicIds: string[];
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ── Master data (Phase 3) ────────────────────────────────────────────────────

/** A clinic master record. */
export interface Clinic {
  id: string;
  name: string;
  location: string;
  corporateClient: string;
  isActive: boolean;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** An expense-head master record. */
export interface ExpenseHead {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** A clinic ↔ expense-head mapping row (a head applies to a clinic only if mapped & active). */
export interface ClinicExpenseHead {
  id: string;
  clinicId: string;
  expenseHeadId: string;
  isActive: boolean;
}

/** Active/inactive list filter shared by the master-data lists. */
export type ActiveFilter = 'active' | 'inactive' | 'all';

/**
 * An expense head that currently applies to a clinic (active mapping + active
 * head). This is the set the provision form renders — empty until heads are
 * explicitly mapped.
 */
export interface MappedExpenseHead {
  mappingId: string;
  expenseHeadId: string;
  name: string;
  category: string;
}

// ── Submission comments / timeline (Phase 5) ─────────────────────────────────

/**
 * The two reviewer actions a comment can accompany. DB-local (mirrors the
 * Prisma `CommentAction` enum); kept here so the web timeline can type-check
 * without importing from the API.
 */
export type SubmissionCommentAction = 'SENT_BACK' | 'APPROVED';

/**
 * A comment as shown on a submission's review timeline. Send-backs always carry
 * one (mandatory); approvals may. `roleAtTime` is the commenter's role when the
 * action happened, frozen so the timeline reads correctly even if the user's
 * role later changes.
 */
export interface SubmissionCommentView {
  id: string;
  comment: string;
  action: SubmissionCommentAction;
  roleAtTime: UserRole;
  createdAt: string; // ISO-8601, UTC
  commentedBy: {
    id: string;
    name: string;
  };
}

// ── Provision entry / SPOC workspace (Phase 6) ───────────────────────────────

/**
 * One accessible clinic's submission status for a given month — the row shape of
 * the SPOC home overview. `submissionId` is null until the cycle is opened.
 */
export interface ClinicMonthStatus {
  clinicId: string;
  clinicName: string;
  month: string; // YYYY-MM
  submissionId: string | null;
  status: SubmissionStatus;
  locked: boolean;
}

/** A submission as a row in a clinic's history list. */
export interface SubmissionListItem {
  id: string;
  clinicId: string;
  clinicName: string;
  month: string; // YYYY-MM
  status: SubmissionStatus;
  locked: boolean;
  submittedAt: string | null; // ISO-8601
  approvedByFinanceAt: string | null; // ISO-8601
}

/**
 * One snapshot expense head as a row in the provision form. `amount` is the
 * entered INR value as a DECIMAL(14,2) string, or null when nothing has been
 * entered yet (blank — distinct from an explicit "0.00").
 */
export interface ProvisionHeadRow {
  snapshotId: string;
  expenseHeadId: string;
  name: string;
  category: string;
  amount: string | null;
}

/** Full provision form / read-only detail for a single submission. */
export interface SubmissionDetail {
  id: string;
  clinicId: string;
  clinicName: string;
  month: string; // YYYY-MM
  status: SubmissionStatus;
  locked: boolean;
  /** True only when the viewer is a SPOC and the status still permits editing. */
  canEdit: boolean;
  submittedAt: string | null; // ISO-8601
  reviewStartedAt: string | null; // ISO-8601 — stamped when a reviewer opens it
  reviewStartedByName: string | null;
  /** Reason from the most recent Finance-Admin unlock, if any. */
  unlockedReason: string | null;
  heads: ProvisionHeadRow[];
}

/** A single value being saved against a snapshot head (0 is valid; blank = omit). */
export interface ProvisionEntryInput {
  snapshotId: string;
  amount: number;
}

// ── Notification config (Phase 10.1) ─────────────────────────────────────────

/** Per-cycle notification config (one row per month). Read by scheduler + dashboard. */
export interface NotificationConfigView {
  month: string; // YYYY-MM
  monthStartNotifyDate: string; // ISO-8601
  cutoffDate: string; // ISO-8601
  preCutoffReminderDays: number;
  varianceThresholdPercent: string; // DECIMAL(5,2) as string
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Finance-Admin input to set/update a month's notification config. */
export interface NotificationConfigInput {
  monthStartNotifyDate: string; // ISO-8601
  cutoffDate: string; // ISO-8601
  preCutoffReminderDays: number;
  varianceThresholdPercent: number;
}

// ── Notifications (Phase 10.2) ───────────────────────────────────────────────

/** An in-app notification as shown in the tray. */
export interface NotificationView {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string; // ISO-8601
  submissionId: string | null;
}

// ── Audit log viewer (Phase 9.2) ─────────────────────────────────────────────

/** One audit row as shown in the Finance-Admin audit viewer. */
export interface AuditLogView {
  id: string;
  performedAt: string; // ISO-8601, UTC
  action: string;
  entityType: string;
  entityId: string;
  clinicId: string | null;
  clinicName: string | null;
  performedById: string | null; // null = SYSTEM action
  performedByName: string | null;
  ipAddress: string | null;
  oldValue: unknown | null;
  newValue: unknown | null;
}

/** A page of audit rows (newest first). */
export interface AuditLogPage {
  items: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Dashboards & analytics (Phase 11, FR-07) ─────────────────────────────────

/**
 * One clinic's current-month submission status for the status tracker. `total`
 * is the summed entered amount (DECIMAL(14,2) string) or null when nothing has
 * been entered. `status` is NOT_STARTED when no cycle row exists yet.
 */
export interface DashboardStatusTile {
  clinicId: string;
  clinicName: string;
  month: string; // YYYY-MM
  status: SubmissionStatus;
  submissionId: string | null;
  total: string | null; // DECIMAL(14,2) as string
}

/** A month → total point for the month-on-month expense comparison. */
export interface MonthlyTotalPoint {
  month: string; // YYYY-MM
  total: string; // DECIMAL(14,2) as string
}

/** A (month, expense head) → total point for expense-head-wise trends. */
export interface HeadTrendPoint {
  month: string; // YYYY-MM
  expenseHeadId: string;
  expenseHeadName: string;
  total: string; // DECIMAL(14,2) as string
}

/** A clinic → total for the clinic-wise comparison over a month range. */
export interface ClinicTotalPoint {
  clinicId: string;
  clinicName: string;
  total: string; // DECIMAL(14,2) as string
}

/**
 * One expense head's month-on-month variance (BR-12). `deviationPercent` is the
 * signed % change vs the prior month, or null when there is no prior baseline
 * (prior total was zero/absent). `flagged` is true when the deviation breaches
 * the configured threshold.
 */
export interface VarianceRow {
  expenseHeadId: string;
  expenseHeadName: string;
  current: string; // DECIMAL(14,2) as string
  prior: string | null; // DECIMAL(14,2) as string
  deviationPercent: string | null; // signed %, 2dp; null = no prior baseline
  flagged: boolean;
}

/** Variance report for a month vs its prior month. */
export interface VarianceReport {
  month: string; // YYYY-MM
  priorMonth: string; // YYYY-MM
  /** From NotificationConfig.varianceThresholdPercent for `month`; null if unset. */
  thresholdPercent: string | null;
  rows: VarianceRow[];
}

/** Dropdown options for the dashboard filters, scoped to the caller. */
export interface DashboardFilterOptions {
  clinics: { id: string; name: string }[];
  expenseHeads: { id: string; name: string }[];
}

/** Standard error envelope returned by the API. */
export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

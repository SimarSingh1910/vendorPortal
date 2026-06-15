# PROJECT CONTEXT — Cost Provision Portal (HCL Avitas)

> Handoff/context document. Current through **PHASE 2 · STEP 2.1**.
> Paste into a Claude chat (or any LLM) to bring it up to speed on this project.

## What this is
A web portal replacing a manual email/Excel process. Clinics inside corporate
campuses across India submit a monthly cost-provision estimate; Finance routes it
through a 3-level approval chain, then locks it.

## Tech stack (fixed)
- **Frontend**: React + TypeScript, Vite, shadcn/ui, React Query (server state) +
  Zustand (UI state), Recharts, React Router v6 (role-based protected routes).
- **Backend**: NestJS (TypeScript), Prisma ORM, MySQL 8 (InnoDB, utf8mb4 /
  utf8mb4_unicode_ci).
- **Auth**: JWT access token (short-lived) + rotating refresh token; bcrypt (>=12 rounds).
- **Notifications**: AWS SES (Nodemailer) + in-app SSE. **Export**: ExcelJS + Puppeteer.
- **Repo**: monorepo (pnpm workspaces) — `/apps/api` (NestJS), `/apps/web` (React),
  `/packages/shared` (types/enums).
- **Money**: INR only, `DECIMAL(14,2)`. Timestamps stored UTC, displayed IST (+5:30).

## Roles (one per user; clinic roles map to many clinics)
- FINANCE_ADMIN — full access (masters, users, approve/reject all, unlock, audit, export)
- FINANCE_VIEWER — read-only across all clinics
- CLINIC_MANAGER — 1st-level approver for assigned clinic(s); cannot edit values
- CLINIC_SPOC — data entry for assigned clinic(s); draft/submit/revise
- CLINIC_VIEWER — read-only for assigned clinic(s)

## Submission lifecycle (per clinic, per month YYYY-MM)
NOT_STARTED -> DRAFT -> SUBMITTED -> CLINIC_MANAGER_REVIEW -> CLINIC_APPROVED ->
FINANCE_REVIEW -> FINANCE_APPROVED (locked).
Send-back states: SENT_BACK_BY_MANAGER, SENT_BACK_BY_FINANCE (both return to SPOC).
CLINIC_MANAGER_REVIEW and FINANCE_REVIEW are REAL persisted states stamped the moment
a reviewer opens an item (reviewStartedAt / reviewStartedById).

## Non-negotiable rules (enforced on BACKEND)
- RBAC in API guards, never frontend-only.
- A submission can be SUBMITTED only when EVERY active expense head for that
  clinic/month has an explicitly entered value (0 is valid; blank is not).
- Finance send-back RESETS workflow to SPOC; Manager must re-approve before Finance.
- FINANCE_APPROVED = locked; only FINANCE_ADMIN can unlock, with a mandatory
  audit-logged reason.
- Master changes (clinic/expense-head add/deactivate) take effect NEXT month cycle
  only; deactivation never deletes history. Enforced by SNAPSHOTTING the active
  expense-head set onto the submission when its cycle opens.
- A head appears for a clinic only if mapped (ClinicExpenseHead, active). No mapping
  = empty form.
- Month cycles open AUTOMATICALLY via a scheduled job (admin re-run fallback exists).
- Audit log is APPEND-ONLY (target: enforced at MySQL level via triggers).
- Access changes (role/clinic/deactivation) take effect immediately; sessions
  invalidated on role change/deactivation. Auto-logout after 30 min inactivity.

## NFRs
Pages < 3s; 200 concurrent users / 100 clinics / 50 expense heads; HTTPS TLS 1.2+;
responsive 1280px+ desktop & 768px+ tablet; daily backups 30-day retention; data
resident in India.

---

# PROGRESS SO FAR

## PHASE 1 — Data model  [COMPLETE]

### STEP 1.1 — Prisma schema (MySQL)
`apps/api/prisma/schema.prisma`. Provider = mysql. 12 domain tables, all
InnoDB/utf8mb4_unicode_ci. Native MySQL ENUMs for UserRole, SubmissionStatus,
CommentAction. Money = @db.Decimal(14,2); free-text = @db.Text; audit values = Json.

Tables: Clinic, ExpenseHead, ClinicExpenseHead (composite unique clinicId+expenseHeadId),
User (email unique VARCHAR(191)), UserClinicAssignment (composite unique),
MonthlySubmission (unique clinicId+month; status default NOT_STARTED; lifecycle
timestamps + reviewStartedAt/ById, lockedAt, unlockedReason/ById),
SubmissionExpenseHeadSnapshot (frozen head set; stores expenseHeadNameAtSnapshot +
expenseHeadCategoryAtSnapshot), ProvisionEntry (FK snapshotId, unique
(submissionId, snapshotId), amount Decimal(14,2)), SubmissionComment (action enum
SENT_BACK|APPROVED), AuditLog (oldValue/newValue Json, performedAt, ipAddress),
Notification, NotificationConfig (per-month config, unique month).
Indexes on clinicId, month, status, performedAt, userId.

Verified: `prisma migrate dev` applies clean; all 12 tables InnoDB/utf8mb4;
rupee symbol + en-dash round-trips exactly through a TEXT column.

### STEP 1.2 — `docs/DATA_MODEL_NOTES.md`
Documents WHY the entry form is driven by SubmissionExpenseHeadSnapshot (frozen at
cycle open), NOT live ClinicExpenseHead/ExpenseHead. This is how master changes only
affect future cycles and deactivation never alters history. ProvisionEntry.snapshotId
FK is the structural enforcement (entry only against a snapshotted head).

## PHASE 2 — Auth & RBAC  (IN PROGRESS)

### STEP 2.1 — Auth core  [COMPLETE]
Added `RefreshToken` model + migration (stores only SHA-256 hash of the signed token,
plus expiresAt, revokedAt, replacedById for rotation/reuse-detection).
Created global PrismaModule/PrismaService. Built AuthModule/Service/Controller:
- `POST /api/auth/login` — bcrypt verify (12 rounds); generic 401 + dummy-hash
  compare to blunt user enumeration; rejects inactive accounts. Returns
  { accessToken, refreshToken, user }.
- `POST /api/auth/refresh` — verifies refresh JWT -> looks up its jti row -> checks
  not-revoked/not-expired/hash-match/active-user -> ROTATES (new pair, revoke old,
  link replacedById). Replaying a revoked token = reuse -> revokes ALL the user's
  live tokens.
- `POST /api/auth/logout` — idempotently revokes the presented refresh token.

Access token: 15 min TTL, claims = { sub, email, role, clinicIds } (clinicIds loaded
from UserClinicAssignment — ready for RBAC scoping). Distinct secrets for access vs
refresh; TTLs/secrets/bcrypt rounds from env/ConfigService.
Shared types added: AuthUser, AuthTokens, AuthResponse.

Verified live (server + MySQL): login returns pair; 15m TTL; wrong password -> 401;
refresh issues new pair & old refresh rejected; reuse of revoked token kills the
chain; logout -> subsequent refresh 401.

Deps added: @nestjs/jwt, bcrypt (both already in the fixed stack). Passport
deliberately NOT used — guards will use @nestjs/jwt directly.

---

# CURRENT FILE LAYOUT (key files)
```
apps/api/
  prisma/
    schema.prisma                  # 13 models (12 domain + RefreshToken)
    migrations/                    # init, email_varchar191, refresh_token
  src/
    main.ts                        # global /api prefix, ValidationPipe, CORS
    app.module.ts                  # ConfigModule + PrismaModule + AuthModule + HealthModule
    prisma/prisma.service.ts       # PrismaClient lifecycle
    prisma/prisma.module.ts        # @Global
    auth/auth.module.ts
    auth/auth.controller.ts        # /auth/login, /auth/refresh, /auth/logout
    auth/auth.service.ts           # login/refresh/logout, rotation, reuse-detection
    auth/dto/login.dto.ts
    auth/dto/refresh.dto.ts
    common/rbac.constants.ts       # role/status constant groups (no string literals)
    health/health.controller.ts
packages/shared/src/
  enums.ts                         # UserRole, SubmissionStatus (+ labels)
  types.ts                         # JwtClaims, AuthUser, AuthTokens, AuthResponse, ...
  index.ts                         # explicit named re-exports
docs/
  DATA_MODEL_NOTES.md
  PROGRESS.md                      # this file
```

# ENVIRONMENT NOTES
- Windows 11; pnpm at %APPDATA%\npm (corepack blocked). Docker NOT installed —
  but MySQL 8 IS installed/running locally (service MySQL80, port 3306).
- App DB user `cpp` / db `cost_provision` (+ shadow db) per apps/api/.env.
- API listens on http://localhost:3000/api.

# NEXT UP
STEP 2.2 — RBAC: JWT access-token guard, @Roles decorator + RolesGuard, clinic-scope
enforcement, and session invalidation on role change / deactivation (the
RefreshToken.revokedAt design already supports it).

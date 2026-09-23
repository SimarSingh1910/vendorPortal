# Implementation Context — Cost Provision Portal (HCL Avitas)

**Scope:** everything implemented through **Phase 4, Step 4.1**.
**Last updated:** 2026-09-18

A NestJS + Prisma + **MySQL 8.4 (Docker)** backend and a React + Vite frontend in a
pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`).

---

## Stack & layout

| Part | Tech |
|---|---|
| API | NestJS 10, Prisma 6, MySQL 8.4 (container), class-validator, JWT (access+refresh), bcrypt |
| Web | React 18, Vite 6, React Router v6, React Query, Zustand, shadcn/ui, Tailwind, axios, react-hook-form + zod |
| Shared | `@portal/shared` — enums (`UserRole`, `SubmissionStatus`) + cross-cutting types |

13 Prisma models (12 domain + `RefreshToken`). DB charset `utf8mb4 / utf8mb4_unicode_ci`.

Run (from repo root, with pnpm on PATH):
- DB: `docker compose up -d`
- API: `pnpm --filter @portal/api start` → http://localhost:3000/api
- Web: `pnpm --filter @portal/web dev` → http://localhost:5173
- Dev admin: `admin@cpp.local` / `Admin@12345`

---

## Infrastructure (pre-Phase-2 housekeeping)

### Dev database → Docker
- `docker-compose.yml` (root): `mysql:8.4`, container `cpp-mysql`, host port **3307** (native MySQL80 on 3306 untouched), utf8mb4 server flags, **`--lower-case-table-names=1`** (required — committed migrations reference both `User` and `user`; Linux MySQL defaults to case-sensitive), healthcheck, named volume `cpp_mysql_data`.
- `docker/mysql-init/init.sql`: creates `cost_provision_shadow` + grants `cpp` on both DBs.
- `apps/api/.env` / `.env.example`: DB URLs on port 3307.
- Dev admin seed: `apps/api/prisma/seed-admin.ts` (`pnpm prisma:seed:admin`) — idempotent upsert; on re-provision of an existing user it invalidates sessions (mirrors `AuthService.invalidateUserSessions`).
- Details: `docs/dev-db-containerization.md`.

### Git
- Repo initialized; root `.gitignore` covers `node_modules/`, `dist/`, `build/`, `.env`/`.env.*` (but not `.env.example`), `*.log`, `coverage/`, Prisma client output, `.claude/settings.local.json`.
- `.env` is untracked; `docker-compose.yml`, `init.sql`, seed, `.env.example` are tracked. No remote / push (left to user).

---

## Phase 2 — Authentication & RBAC

### 2.2a — per-user `tokenVersion`
- `User.tokenVersion Int @default(0)` (migration `user_token_version`). Stamped into every access token at issue (login + refresh).

### 2.2b — JWT access guard (global)
- `JwtAccessGuard` (global `APP_GUARD`): verifies access JWT, loads user by `sub`, rejects 401 if missing / `!isActive` / `claims.tokenVersion !== user.tokenVersion`. Attaches typed `request.user = { id, email, role, clinicIds, tokenVersion }`.
- `@Public()` decorator exempts routes. Public: login, refresh, logout, health.

### 2.2c — roles guard
- `@Roles(...UserRole[])` + `RolesGuard` (global, runs after JwtAccessGuard). 403 on role mismatch. No role string literals — uses `UserRole` / `rbac.constants`.

### 2.2d — clinic-scope guard
- `ClinicScopeService.accessibleClinicIds(user)` (all clinics for finance roles, assigned for clinic roles), `canAccessClinic`, `resolveSubmissionClinicId`.
- `ClinicScopeGuard` (`@UseGuards`): resolves target clinic from `:clinicId` or `:submissionId`; 403 if outside the caller's set, 404 if submission missing.

### 2.3 — session lifecycle
- `AuthService.invalidateUserSessions(userId)`: **atomic** — bump `tokenVersion` (kills access tokens on next request) **and** revoke all live refresh tokens. The single kill switch reused everywhere a user's role/isActive/assignments change.
- `GET /api/auth/me` → `AuthUser` (`{ id, name, email, role, clinicIds }`); returns 401 once the session is killed.
- Inactivity model documented in `docs/AUTH_NOTES.md` (15-min access TTL, refresh rotation + reuse-detection, tokenVersion immediate-invalidation, 30-min client idle).

### 2.4 — frontend auth shell
- Access token in **memory** (Zustand); refresh token in localStorage (rotated). axios client attaches token, on 401 does a single `/auth/refresh` + retry, clears auth on failure.
- Bootstrap: on load, `/auth/me` (401 → refresh → retry) re-establishes the session; rendering gated until resolved.
- `ProtectedRoute` (auth + allowed-roles), per-role home, role-filtered nav.
- 30-min idle auto-logout (resets on activity; override `VITE_IDLE_TIMEOUT_MS`).
- **Verified end-to-end in headless Chromium:** login, reload-keeps-session (`me 401 → refresh 200 → me 200`), forbidden-route redirect, idle logout, and invalidation bounce.

---

## Phase 3 — Master Data (FR-01, Finance Admin only)

All endpoints `@Roles(FINANCE_ADMIN)` behind the global `JwtAccessGuard`. Deactivation flips
`isActive=false` and never touches history. List filter `?status=active|inactive|all`.

| Step | Backend | Frontend |
|---|---|---|
| 3.1 Clinics | `clinics/` CRUD + deactivate/activate + `DELETE /clinics/:id` (safe delete) | `/admin/clinics` table + add/edit modal + filter + delete confirm showing the 409 reason |
| 3.2 Expense heads | `expense-heads/` (name, category) | `/admin/expense-heads` |
| 3.3 Mapping | `clinics/:clinicId/expense-heads` GET (active mapping + active head) / PUT (replace set; removed = deactivated) | `/admin/mappings` clinic selector + checklist + live "applies" count |

**3.3 invariants verified:** new clinic shows **0** heads; mapping exactly 3 → exactly those 3; a mapping change does **not** alter an existing submission's `SubmissionExpenseHeadSnapshot` (stayed byte-identical even after renaming the head).

Shared types added: `Clinic`, `ExpenseHead`, `ClinicExpenseHead`, `MappedExpenseHead`, `ActiveFilter`.

---

## Safe delete — the one narrow exception to "never delete"

`DELETE /clinics/:id` and `DELETE /users/:id` (both FINANCE_ADMIN) hard-delete a row **only when it
carries no history**. If anything auditable references it the API refuses with **409** and a message
naming what blocks it and telling the admin to deactivate instead — nothing auditable is ever
destroyed. Nothing else in the portal can be deleted: expense heads, mappings, corporate departments
and budget codes have no delete endpoint at all, and for them deactivation remains the only way to
retire a row.

| Delete | Refused (409) when | Cascades away (no history) |
|---|---|---|
| `DELETE /clinics/:id` | it has any `MonthlySubmission`; or any clinic-scoped user whose **only** clinic is this one — deleting it would leave them with zero clinics, which the ≥1-clinic invariant forbids, so those users must be reassigned first | `ClinicExpenseHead` mappings, `UserClinicAssignment` rows |
| `DELETE /users/:id` | they appear anywhere in history: provision entries (clinic or corporate), submission comments, comment attachments, a Sec 24 allocation config, a review they started or an unlock they performed, **or any audit row they wrote**. The message names the categories with counts — *"This user appears in submission history (12 provision entries, 3 comments) and cannot be deleted. Deactivate the account instead."* | `UserClinicAssignment`, `UserDepartmentAssignment`, `RefreshToken`, `Notification` |

Every blocker is counted in the **service**, never left to the database. Three of the user
references (`AuditLog.performedById`, `MonthlySubmission.reviewStartedById`, `.unlockedById`) are FK
`ON DELETE SET NULL`, and MySQL does not fire the append-only `auditlog_no_update` trigger for FK
cascade actions — so without the application check the delete would succeed and silently null out a
submission's reviewer or an audit row's actor. Because nearly every admin action writes an audit row
naming its actor, in practice nearly every user who has ever done anything is undeletable; delete is
for the account mistyped five minutes ago, not for retiring staff.

Each delete is **one interactive transaction**: blockers, the `*_DELETE` audit row and the delete
itself commit together, so the audit row — the only surviving record of what was removed — can never
fail to commit after the row is already gone. The transaction alone does *not* make the counts
race-free (under REPEATABLE READ the counts are snapshot reads while the `DELETE` is a current read),
so each delete's **first** statement is `SELECT id … FOR UPDATE` on the row being deleted. InnoDB
takes a shared lock on that parent row when FK-checking an insert that references it, so a
`MonthlySubmission` (e.g. the nightly scheduler opening a cycle) or an `AuditLog` row written
concurrently blocks until the delete commits, then fails with a clean FK error instead of being
silently cascaded away or null'd. The user delete additionally locks the active `FINANCE_ADMIN` rows
before counting them, so two admins deleting each other concurrently cannot both pass the last-admin
guard and leave the portal with no administrator. A clinic delete also bumps `tokenVersion` and revokes the
refresh tokens of every user whose assignment cascades away — see `docs/AUTH_NOTES.md`. A row deleted
by someone else in the meantime surfaces as 404, not 500.

`AuditLog` rows survive both deletes untouched — `AuditLog.clinicId` deliberately carries no FK, so a
deleted clinic's audit trail stays searchable. Each delete writes its own audit row: `CLINIC_DELETE` /
`USER_DELETE` (added to `packages/shared/src/audit-actions.ts`; the audit viewer's filter list is
DB-derived, so they appear there after the first such row exists).

---

## Phase 4 — User & Access Management (FR-02, Finance Admin only)

### 4.1 — User CRUD + assignments (`users/`, `/admin/users`)
- Create / edit / deactivate-activate / delete (safe delete — see above); exactly one role; clinic-scoped roles map to ≥1 clinic.
- **Every** role / email / isActive / clinic-assignment change (and password reset) calls `invalidateUserSessions` → effective on the user's next request and ends their current session.
- Finance roles normalize `clinicIds` to `[]`; invalid clinic → 400; duplicate email → 409.
- **Email is editable** (`PATCH /users/:id` accepts `email`, validated exactly as on create — `@IsEmail()` + `@MaxLength(191)`, no trimming or lowercasing anywhere in the app). Unchanged = no-op; changed = uniqueness enforced (409 `Email already in use`), audited old → new, and it counts as security-relevant, so it **ends the user's sessions** like a role change does. The edit dialog says so, and warns in stronger words when you are editing your own account. The uniqueness lookup excludes the user's own row — the column collates `utf8mb4_unicode_ci` (case- *and* accent-insensitive), so a casing-only edit matches the target itself; a concurrent duplicate that escapes the lookup is caught as `P2002` and re-raised as the same 409 rather than a 500.
- Self-protection: admin can't deactivate self, delete self, or demote self out of `FINANCE_ADMIN`; deleting the **last active** `FINANCE_ADMIN` is refused (400) — it would lock everyone out.
- Deactivation preserves the user row + audit references; delete is only ever possible when there are none.
- Frontend: table + modal with role `<select>`, a clinic checklist shown only for clinic roles, and an email field that is editable on edit (format-validated on create *and* edit).
- Added `AdminUser` to shared; `AuthService.hashPassword`.

**Acceptance verified** — backend (curl) + UI (headless Chromium): each role created; finance normalization; **reassigning a SPOC's clinics → old access token 401, refresh 401, re-login shows new clinic, and the live UI session bounces to /login**; deactivated user can't log in but remains listed and resolvable from audit logs; non-admin → 403.

---

## How verification was done

- **Backend:** curl flows against the running API (status codes + JSON), plus direct SQL via `docker exec` for retention/snapshot invariants.
- **UI:** Playwright + headless Chromium drove the real app (login, modals, filters, redirects, session-kill), capturing the network sequence like DevTools. Playwright was installed only for the run and uninstalled after each phase — it is **not** a project dependency.
- After each step, temporary scripts/test data were removed; the dev DB is reset to a single admin (`tokenVersion 0`).

---

## Current state

- Routes live for Finance Admin: **Clinics, Expense Heads, Mappings, Users** (plus per-role homes).
- Dev DB: one user (`admin@cpp.local`), no clinics/heads/mappings/extra users.
- All changes are **uncommitted** in the working tree (committing/pushing left to the user).
- No remote configured.

### Notable decisions
- `lower_case_table_names=1` on the container to match the original native MySQL and let committed migrations replay.
- `POST /auth/logout` is `@Public()` (authenticates via the refresh token; must work with an expired access token).
- Refresh token in localStorage (backend returns it in the body); an httpOnly cookie is the noted future hardening.
- Access token in memory only.

### Not yet built (next phases)
Submission workflow & state machine, provision data entry (with expense-head **snapshots** at submission time), approvals/lock/unlock, notifications, audit-log writes, reporting.

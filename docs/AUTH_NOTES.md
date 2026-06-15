# Authentication & Session Notes

Cost Provision Portal — how tokens, sessions, and inactivity are handled.

## Token model

The API issues a **token pair** on `POST /api/auth/login` and on every
`POST /api/auth/refresh`:

| Token | Lifetime | Secret | Purpose |
|---|---|---|---|
| **Access** | **15 min** (`JWT_ACCESS_TTL`) | `JWT_ACCESS_SECRET` | Sent as `Authorization: Bearer <token>` on every request. |
| **Refresh** | **7 days** (`JWT_REFRESH_TTL`) | `JWT_REFRESH_SECRET` | Exchanged at `/api/auth/refresh` for a new pair. Rotates on each use. |

Access-token claims (`JwtClaims`): `sub`, `email`, `role`, `clinicIds`,
`tokenVersion` (plus standard `iat` / `exp`).

## Access TTL bounds server-side inactivity (15 min)

An access token is valid for at most 15 minutes. After it expires the client
must present its refresh token to mint a new one. This is the server-side bound
on inactivity: a stolen or stale access token stops working within 15 minutes
even if nothing else revokes it.

## Refresh rotation + reuse detection

Refresh tokens are **single-use and rotating**:

- Only a **SHA-256 hash** of each refresh token is stored (`RefreshToken.tokenHash`)
  — the raw token is never persisted.
- On `/api/auth/refresh`, the presented token is validated, a **new** pair is
  issued, and the old row is revoked (`revokedAt` set) with `replacedById`
  linking the chain.
- **Reuse detection:** presenting an *already-revoked* refresh token means the
  chain is compromised (the token was replayed). The server then revokes **all**
  of that user's live refresh tokens and rejects the request (401). The
  legitimate user must log in again.
- Expired or hash-mismatched refresh tokens are rejected (401).
- `POST /api/auth/logout` is idempotent and revokes the presented refresh token;
  it authenticates via the refresh token in the body, so it works even after the
  access token has expired.

## tokenVersion — immediate invalidation

Each user row carries an integer `tokenVersion` (default 0), stamped into every
access token at issue time. The global `JwtAccessGuard` re-checks the user on
**every request** and rejects (401) if the user is missing, `isActive === false`,
or `claims.tokenVersion !== user.tokenVersion`.

`AuthService.invalidateUserSessions(userId)` is the single, centralized kill
switch. Atomically it:

1. bumps `user.tokenVersion` → all outstanding **access** tokens fail the guard's
   version check on their very next request (no waiting for the 15-min TTL); and
2. revokes all live **refresh** tokens → they can no longer be rotated.

It must be called on **any** change to a user's `role`, `isActive`, or clinic
assignments. Current call sites: the seed/admin tooling
(`prisma/seed-admin.ts`, when re-provisioning an existing user). Phase 4 user
management will reuse the same method for role changes, deactivation, and
assignment edits.

This gives **immediate** revocation across both token types — the basis for
"deactivate a user / change their role and they're locked out right away."

## Client-side idle auto-logout (30 min) — enforced in 2.4

Separate from the server's 15-min access TTL, the frontend enforces a **30-minute
inactivity timeout**: if the user performs no activity for 30 minutes, the client
clears its tokens and redirects to login (it does not silently refresh in the
background while idle). `GET /api/auth/me` is used to bootstrap the session on
load and to detect invalidation — it returns 401 once the session is killed
server-side, which the client treats as a forced logout.

The 30-min idle timeout is a **client-side** policy (implemented in step 2.4);
the server independently bounds inactivity to 15 min via the access TTL and can
force-revoke at any time via `tokenVersion`.

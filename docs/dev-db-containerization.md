# Dev Database Containerization — MySQL → Docker

**Project:** Cost Provision Portal (HCL Avitas)
**Date:** 2026-06-15
**Scope:** Switch the dev database from a natively-installed Windows MySQL 8 to a Docker container. App code unchanged — only the DB host and connection string.

---

## Result

A `mysql:8.4` container (`cpp-mysql`) runs the dev database on host port **3307** (→ 3306 inside), so the native `MySQL80` service on 3306 keeps running untouched. The committed Prisma schema (13 models) is applied, charset is enforced as `utf8mb4 / utf8mb4_unicode_ci`, and a dev Finance Admin can log in via the API.

---

## Files created / changed

| File | Change |
|---|---|
| `docker-compose.yml` | Replaced a stale 8.0/3306 draft with the 8.4/3307 service (+ `--lower-case-table-names=1`, see Deviation) |
| `docker/mysql-init/init.sql` | **Created** — creates `cost_provision_shadow` (utf8mb4) and grants `cpp` on both DBs |
| `apps/api/.env` | Only the 2 DB URL lines changed → `cpp:cpp_local_dev@localhost:3307/...` (gitignored) |
| `apps/api/.env.example` | Same 2 DB URL lines updated (placeholders, port 3307) |
| `apps/api/prisma/seed-admin.ts` | **Created** — idempotent Finance Admin upsert (bcrypt, `BCRYPT_ROUNDS`) |
| `apps/api/package.json` | Added `prisma:seed:admin` script (compiles to gitignored `dist/`, then runs) |

All other env vars (JWT secrets, TTLs, bcrypt rounds) were preserved. `.env` is covered by the root `.gitignore`.

---

## Required deviation from the spec

The committed migration `20260615120931_email_varchar191` does `ALTER TABLE \`user\`` (lowercase), while `init` created `User`. This only ever worked because **native Windows MySQL is case-insensitive** (`lower_case_table_names=1`); the Linux `mysql:8.4` container defaults to `0`, so `prisma migrate dev` failed with:

```
Table 'cost_provision_shadow.user' doesn't exist
```

**Fix (user-approved):** added `--lower-case-table-names=1` to the compose `command:`. This flag is honored only at first data-dir init, so the brand-new **empty** volume was recreated (no data existed). The container now behaves byte-identically to the original native environment.

Side effect: `SHOW TABLES` now lists names lowercased (`user`, `auditlog`, …). Expected — not schema drift.

---

## Steps performed

1. Confirmed Docker daemon running (`docker info`).
2. Wrote `docker-compose.yml` (mysql:8.4, port 3307, utf8mb4 server flags, healthcheck, named volume `cpp_mysql_data`, init-script mount).
3. Created `docker/mysql-init/init.sql` (shadow DB + grants).
4. Updated the 2 DB URL lines in `apps/api/.env` and `.env.example` (port 3307, `cpp_local_dev` creds).
5. `docker compose up -d`, polled `docker inspect` until `healthy`.
6. Verified both `cost_provision` and `cost_provision_shadow` exist.
7. First `prisma migrate dev` failed → diagnosed `lower_case_table_names=0` → added the flag → recreated the empty volume → re-ran.
8. `prisma migrate dev` applied all 3 migrations (init, email_varchar191, refresh_token) and regenerated the client.
9. Created and ran `seed-admin.ts` to upsert the dev admin.
10. Booted the API and verified login end-to-end.

---

## Verification (all passed)

| Check | Result |
|---|---|
| `docker compose ps` | `cpp-mysql … Up (healthy)` |
| `SHOW DATABASES` | `cost_provision` + `cost_provision_shadow` present |
| `prisma migrate status` | All 3 migrations applied, no drift |
| App table count | **13** |
| Schema charset | `utf8mb4 / utf8mb4_unicode_ci` |
| Unicode round-trip | `₹1,200 – April` → `E282B9312C32303020E2809320417072696C`, byte-identical |
| `POST /api/auth/login` | **200** with tokens; wrong password → **401** |

---

## Dev admin login (dev only)

```
email:    admin@cpp.local
password: Admin@12345
```

Re-seed anytime from `apps/api`: `pnpm prisma:seed:admin`

---

## Operational notes

- Named volume `cpp_mysql_data` persists data across `docker compose down`/`up`. Only `docker compose down -v` wipes it (which re-triggers `init.sql` on next `up`).
- Host port **3307** keeps the native `MySQL80` (3306) untouched. If MySQL80 is later disabled, the compose port and `.env` can move back to 3306.
- Charset is enforced at the server level via the compose `command:` flags, so every DB/table the container creates defaults to utf8mb4.

---

## Git

This project is **not** a git repository (no `.git`), so nothing was committed. When initializing, include:

```
docker-compose.yml
docker/mysql-init/init.sql
apps/api/prisma/seed-admin.ts
apps/api/package.json
apps/api/.env.example
```

Keep `apps/api/.env` out (already gitignored).

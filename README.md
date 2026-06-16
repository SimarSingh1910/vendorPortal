# Cost Provision Portal — HCL Avitas

Monorepo for the Cost Provision Portal: clinics submit monthly cost-provision estimates,
Finance routes them through a 3-level approval chain, then locks them.

## Layout

```
apps/
  api/      NestJS + Prisma + MySQL 8 backend
  web/      React + TypeScript + Vite + shadcn/ui frontend
packages/
  shared/   Shared TypeScript types & enums (roles, submission lifecycle)
```

## Prerequisites

- Node.js >= 20
- pnpm 9 (`corepack enable` or `npm i -g pnpm@9`)
- MySQL 8 (local install, or Docker via the bundled compose file)

## Getting started

```bash
# 1. Install dependencies (workspace-wide)
pnpm install

# 2. Copy env templates and fill in values
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Start MySQL 8 (skip if you run MySQL locally)
pnpm db:up            # docker-compose up -d

# 4. Set up the database schema + a dev admin to log in with
pnpm --filter @portal/api exec prisma generate        # generate the Prisma client
pnpm --filter @portal/api exec prisma migrate deploy   # apply committed migrations
pnpm --filter @portal/api run prisma:seed:admin        # create the dev admin

# 5. Run API + web together
pnpm dev
```

- API: http://localhost:3000/api  (health: http://localhost:3000/api/health)
- Web: http://localhost:5173
- Dev login (from the seed script): `admin@cpp.local` / `Admin@12345`

## Working together

Your local Docker database is **private to your machine** — each developer runs their
own MySQL container with its own data volume. Containers do **not** sync with each
other, and `.env` files are git-ignored. The only things shared between developers are
what's committed to git: the code, `docker-compose.yml`, and the Prisma
`schema.prisma` + `migrations/`.

So the database **structure** stays in sync through Prisma migrations, not through
Docker. The database **data** does not sync at all — seed or create your own locally.

**When you change the schema:**

```bash
# Edit apps/api/prisma/schema.prisma, then:
pnpm --filter @portal/api exec prisma migrate dev --name describe_change
# Commit the generated migration file under prisma/migrations/ alongside your code.
```

**When you pull a teammate's work:**

```bash
git pull
pnpm install                                           # if dependencies changed
pnpm --filter @portal/api exec prisma migrate deploy   # apply their new migrations to your local DB
pnpm dev                                               # rebuilds shared + regenerates the client
```

Rules of thumb:

- Never change the database by hand (no manual `ALTER TABLE` / GUI edits) — always go
  through a migration, or your DBs will silently drift apart.
- Add any new env var to `.env.example` (committed) and tell your teammate to copy it
  into their local `.env`.
- One logical schema change = one migration file, committed with the code that uses it.

## Useful scripts (root)

| Script             | Description                                  |
| ------------------ | -------------------------------------------- |
| `pnpm dev`         | Build shared, then run API + web in parallel |
| `pnpm dev:api`     | Run only the API                             |
| `pnpm dev:web`     | Run only the web app                         |
| `pnpm build`       | Build shared, API, and web                   |
| `pnpm lint`        | ESLint across the workspace                  |
| `pnpm format`      | Prettier write                               |
| `pnpm db:up` / `db:down` | Start / stop the MySQL container         |

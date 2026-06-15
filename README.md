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

# 4. Run API + web together
pnpm dev
```

- API: http://localhost:3000/api  (health: http://localhost:3000/api/health)
- Web: http://localhost:5173

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

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * One-time suite setup: apply the COMMITTED migrations to the test database with
 * `prisma migrate deploy` (never `migrate dev` — tests must not author schema).
 * Idempotent, so a fresh or already-migrated test DB both end up correct.
 */
export default async function globalSetup(): Promise<void> {
  const apiDir = resolve(__dirname, '..');
  const databaseUrl =
    'mysql://cpp:cpp_local_dev@localhost:3307/cost_provision_test?connection_limit=1';

  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

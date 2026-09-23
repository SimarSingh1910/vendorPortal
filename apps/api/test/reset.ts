import type { PrismaService } from '../src/prisma/prisma.service';
import { TEST_DB_NAME } from './env';

/**
 * Empty every data table between tests so each starts from a clean slate.
 * Refuses to run unless DATABASE_URL points at the isolated test DB — a hard
 * guard against ever wiping the dev schema.
 *
 * DELETE, not TRUNCATE: TRUNCATE is DDL for InnoDB, which invalidates the
 * prepared statements Prisma caches on the single pinned connection
 * (connection_limit=1) and makes arbitrary later queries fail with MySQL 1412
 * "Table definition has changed". The test tables are tiny, so DML is free.
 * `auditlog` is the exception and must stay TRUNCATE: its append-only
 * BEFORE DELETE trigger aborts a DELETE, and TRUNCATE does not fire triggers.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes(TEST_DB_NAME)) {
    throw new Error(
      `resetDb refused: DATABASE_URL does not target ${TEST_DB_NAME} (got "${url}")`,
    );
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name <> '_prisma_migrations'`,
  );

  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const { name } of rows) {
    await prisma.$executeRawUnsafe(
      name.toLowerCase() === 'auditlog' ? `TRUNCATE TABLE \`${name}\`` : `DELETE FROM \`${name}\``,
    );
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

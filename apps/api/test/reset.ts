import type { PrismaService } from '../src/prisma/prisma.service';
import { TEST_DB_NAME } from './env';

/**
 * Truncate every data table between tests so each starts from a clean slate.
 * Refuses to run unless DATABASE_URL points at the isolated test DB — a hard
 * guard against ever wiping the dev schema.
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
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${name}\``);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

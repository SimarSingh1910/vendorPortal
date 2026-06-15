/**
 * Idempotent dev seed: upserts a single Finance Admin so the app is usable
 * against a freshly-migrated database (the old admin lived in the native MySQL
 * and is gone after switching the dev DB to the Docker container).
 *
 * Run from apps/api:  pnpm prisma:seed:admin   (see package.json)
 *
 * Re-running is safe — the user is matched by its unique email and updated in
 * place. Uses the project's bcrypt + BCRYPT_ROUNDS (>= 12), matching auth.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Standalone scripts don't get `.env` auto-loaded (only the Prisma CLI does),
 * so load apps/api/.env into process.env before instantiating the client.
 * Minimal parser — no new dependency. Existing env vars win.
 */
function loadEnv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env'),
    join(__dirname, '..', '..', '.env'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();

const prisma = new PrismaClient();

const ADMIN = {
  email: 'admin@cpp.local',
  password: 'Admin@12345', // dev only
  name: 'Finance Admin',
  role: 'FINANCE_ADMIN' as const,
};

async function main(): Promise<void> {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const passwordHash = await bcrypt.hash(ADMIN.password, rounds);

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN.email },
    select: { id: true },
  });

  const user = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: {
      name: ADMIN.name,
      role: ADMIN.role,
      isActive: true,
      passwordHash, // reset so the known dev password always works
    },
    create: {
      email: ADMIN.email,
      name: ADMIN.name,
      role: ADMIN.role,
      isActive: true,
      passwordHash,
    },
  });

  // Re-provisioning an existing user changes role/isActive/password, so its
  // sessions must be invalidated — mirrors AuthService.invalidateUserSessions
  // (the canonical implementation; Phase 4 user management should call that).
  // Inlined here because this standalone script runs outside the Nest DI context.
  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    console.log('  (existing user re-provisioned — sessions invalidated)');
  }

  console.log('✔ Dev admin ready (upserted by email):');
  console.log(`  id:       ${user.id}`);
  console.log(`  role:     ${user.role}`);
  console.log(`  email:    ${ADMIN.email}`);
  console.log(`  password: ${ADMIN.password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

/**
 * Read-only reconciliation report for Step 2 (one clinic per clinic-role user).
 *
 * Lists every clinic-role user (Clinic Manager / SPOC / Viewer) whose clinic
 * assignment is NOT exactly one — i.e. legacy users mapped to many clinics, or
 * to none. The rule is enforced going forward on user create/edit, but existing
 * rows are NOT touched automatically: an admin must open each flagged user and
 * pick a single clinic (the edit dialog now forces a single-select). This script
 * only reports — it writes nothing (no data loss, no audit rows).
 *
 * Run from apps/api:  pnpm report:clinic-assignments   (see package.json)
 * Exit code is non-zero when violations exist, so it can gate a deploy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, UserRole } from '@prisma/client';

// Defined inline (not imported from @portal/shared) so this script compiles
// standalone with the same bare-tsc invocation the seed scripts use.
const CLINIC_ROLES: UserRole[] = [
  UserRole.CLINIC_MANAGER,
  UserRole.CLINIC_SPOC,
  UserRole.CLINIC_VIEWER,
];

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { role: { in: CLINIC_ROLES } },
    include: { assignments: { include: { clinic: { select: { name: true } } } } },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  const offenders = users.filter((u) => u.assignments.length !== 1);

  if (offenders.length === 0) {
    console.log('✔ All clinic-role users are mapped to exactly one clinic. Nothing to reconcile.');
    await prisma.$disconnect();
    return;
  }

  console.log(`⚠ ${offenders.length} clinic-role user(s) violate the one-clinic rule (0 or >1 clinic).`);
  console.log('  Open each in Users & access and pick a single clinic — no assignment is dropped automatically.\n');
  for (const u of offenders) {
    const clinics = u.assignments.map((a) => a.clinic?.name ?? a.clinicId);
    const detail = clinics.length === 0 ? 'NO clinic' : `${clinics.length} clinics: ${clinics.join(', ')}`;
    const active = u.isActive ? '' : ' (inactive)';
    console.log(`  • ${u.role} — ${u.name} <${u.email}>${active}: ${detail}`);
  }

  await prisma.$disconnect();
  // Non-zero exit so CI / a deploy step can flag unreconciled data.
  process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

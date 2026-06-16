/**
 * Full sample/demo seed. Builds on the admin seed (apps/api/prisma/seed-admin.ts)
 * to populate a realistic, walkable dataset: clinics, expense heads, mappings,
 * one user per role with clinic assignments (known dev passwords), per-cycle
 * notification config, and several months of submissions across every status —
 * including one LOCKED and one SENT-BACK, plus a current-month DRAFT a SPOC can
 * drive through the SPOC -> Manager -> Finance flow in the browser.
 *
 * Run from apps/api:  pnpm prisma:seed:demo   (see package.json)
 *
 * Idempotent: it deletes its own demo data (by known names/emails) first, then
 * recreates it. The dev admin is upserted, never deleted.
 *
 * Dev passwords (DEV ONLY):
 *   admin@cpp.local          / Admin@12345    (FINANCE_ADMIN)
 *   finance.viewer@cpp.local / Viewer@12345   (FINANCE_VIEWER)
 *   manager@cpp.local        / Manager@12345  (CLINIC_MANAGER)
 *   spoc@cpp.local           / Spoc@12345     (CLINIC_SPOC)
 *   clinic.viewer@cpp.local  / Clinic@12345   (CLINIC_VIEWER)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, SubmissionStatus, UserRole, CommentAction } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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
const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

// ── Month helpers (IST business month) ───────────────────────────────────────
function currentMonthIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const CUR = currentMonthIST();
const MONTHS = [shiftMonth(CUR, -3), shiftMonth(CUR, -2), shiftMonth(CUR, -1), CUR];
const PRIOR = shiftMonth(CUR, -1);

// ── Master data ──────────────────────────────────────────────────────────────
interface ClinicDef { code: string; name: string; location: string; factor: number; active: boolean }
const CLINICS: ClinicDef[] = [
  { code: 'PUN', name: 'Pune Tech Park Clinic', location: 'Pune', factor: 1.0, active: true },
  { code: 'MUM', name: 'Mumbai BKC Clinic', location: 'Mumbai', factor: 1.2, active: true },
  { code: 'BLR', name: 'Bengaluru Whitefield Clinic', location: 'Bengaluru', factor: 0.9, active: true },
  { code: 'HYD', name: 'Hyderabad Gachibowli Clinic', location: 'Hyderabad', factor: 1.05, active: true },
  { code: 'CHE', name: 'Chennai OMR Clinic', location: 'Chennai', factor: 0.95, active: true },
  { code: 'GUR', name: 'Gurugram Cyber City Clinic (closed)', location: 'Gurugram', factor: 0.8, active: false },
];

interface HeadDef { key: string; name: string; category: string; base: number }
const HEADS: HeadDef[] = [
  { key: 'RENT', name: 'Facility Rent', category: 'Facilities', base: 120_000 },
  { key: 'STAFF', name: 'Clinical Staff Salaries', category: 'Personnel', base: 450_000 },
  { key: 'UTIL', name: 'Utilities (Power & Water)', category: 'Facilities', base: 35_000 },
  { key: 'CONSUM', name: 'Medical Consumables', category: 'Medical', base: 80_000 },
  { key: 'HOUSE', name: 'Housekeeping & Sanitation', category: 'Facilities', base: 25_000 },
  { key: 'EQUIP', name: 'Equipment Maintenance', category: 'Medical', base: 40_000 }, // the variance spiker
  { key: 'PHARMA', name: 'Pharmacy Stock', category: 'Medical', base: 95_000 },
  { key: 'TELECOM', name: 'Internet & Telecom', category: 'IT', base: 12_000 },
];

// Per (clinic, month, head) amount. Historical months drift up slightly; the
// current month mirrors the prior month so only the deliberate spike moves —
// Equipment Maintenance at Mumbai jumps ~2.4x, tripping the variance flag.
function amountFor(clinic: ClinicDef, month: string, head: HeadDef): number {
  const isCurrent = month === CUR;
  const rank = MONTHS.indexOf(month);
  const growth = isCurrent ? 1 + 0.02 * (MONTHS.length - 2) : 1 + 0.02 * rank;
  let amt = head.base * clinic.factor * growth;
  if (isCurrent && head.key === 'EQUIP' && clinic.code === 'MUM') {
    amt = head.base * clinic.factor * 2.4;
  }
  return Math.round(amt);
}

// ── Users ────────────────────────────────────────────────────────────────────
interface UserDef { email: string; password: string; name: string; role: UserRole; clinics: string[] }
const USERS: UserDef[] = [
  { email: 'admin@cpp.local', password: 'Admin@12345', name: 'Finance Admin', role: UserRole.FINANCE_ADMIN, clinics: [] },
  { email: 'finance.viewer@cpp.local', password: 'Viewer@12345', name: 'Finance Viewer', role: UserRole.FINANCE_VIEWER, clinics: [] },
  { email: 'manager@cpp.local', password: 'Manager@12345', name: 'Clinic Manager', role: UserRole.CLINIC_MANAGER, clinics: ['PUN', 'MUM', 'BLR', 'HYD', 'CHE'] },
  { email: 'spoc@cpp.local', password: 'Spoc@12345', name: 'Clinic SPOC', role: UserRole.CLINIC_SPOC, clinics: ['PUN', 'MUM', 'BLR', 'HYD', 'CHE'] },
  { email: 'clinic.viewer@cpp.local', password: 'Clinic@12345', name: 'Clinic Viewer', role: UserRole.CLINIC_VIEWER, clinics: ['PUN', 'MUM'] },
];

// Current-month status per clinic: covers every role's view + the locked /
// sent-back examples, and leaves Pune as a DRAFT the SPOC can submit & walk.
const CURRENT_STATUS: Record<string, SubmissionStatus> = {
  PUN: SubmissionStatus.DRAFT, // SPOC walkable
  MUM: SubmissionStatus.FINANCE_APPROVED, // LOCKED + variance spike
  BLR: SubmissionStatus.SENT_BACK_BY_MANAGER, // SENT-BACK (SPOC revision task)
  HYD: SubmissionStatus.CLINIC_MANAGER_REVIEW, // in the Manager queue
  CHE: SubmissionStatus.FINANCE_REVIEW, // in the Finance queue
};

async function main(): Promise<void> {
  const clinicNames = CLINICS.map((c) => c.name);
  const headNames = HEADS.map((h) => h.name);
  const userEmails = USERS.filter((u) => u.role !== UserRole.FINANCE_ADMIN).map((u) => u.email);

  // ── Idempotent cleanup (also clears any earlier throwaway 'Demo '/'Perf ' data).
  await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
  await prisma.clinic.deleteMany({
    where: { OR: [{ name: { in: clinicNames } }, { name: { startsWith: 'Demo ' } }, { name: { startsWith: 'Perf ' } }] },
  });
  await prisma.expenseHead.deleteMany({
    where: { OR: [{ name: { in: headNames } }, { name: { startsWith: 'Demo ' } }, { name: { startsWith: 'Perf ' } }] },
  });
  await prisma.notificationConfig.deleteMany({ where: { month: { in: MONTHS } } });

  // ── Clinics + heads + mappings.
  const clinicId: Record<string, string> = {};
  for (const c of CLINICS) {
    const row = await prisma.clinic.create({
      data: { name: c.name, location: c.location, corporateClient: 'HCL Avitas', isActive: c.active },
    });
    clinicId[c.code] = row.id;
  }
  const headId: Record<string, string> = {};
  for (const h of HEADS) {
    const row = await prisma.expenseHead.create({ data: { name: h.name, category: h.category, isActive: true } });
    headId[h.key] = row.id;
  }
  for (const c of CLINICS) {
    await prisma.clinicExpenseHead.createMany({
      data: HEADS.map((h) => ({ clinicId: clinicId[c.code], expenseHeadId: headId[h.key], isActive: true })),
    });
  }

  // ── Users (one per role) with clinic assignments.
  const userId: Record<UserRole, string> = {} as Record<UserRole, string>;
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, ROUNDS);
    const assignments = { create: u.clinics.map((code) => ({ clinicId: clinicId[code] })) };
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, isActive: true, passwordHash, tokenVersion: { increment: 1 }, assignments: { deleteMany: {}, ...assignments } },
      create: { email: u.email, name: u.name, role: u.role, isActive: true, passwordHash, assignments },
    });
    userId[u.role] = row.id;
  }
  const spocId = userId[UserRole.CLINIC_SPOC];
  const managerId = userId[UserRole.CLINIC_MANAGER];
  const financeId = userId[UserRole.FINANCE_ADMIN];

  // ── Per-cycle notification config (variance threshold drives BR-12 alerts).
  for (const month of [PRIOR, CUR]) {
    await prisma.notificationConfig.create({
      data: {
        month,
        monthStartNotifyDate: new Date(`${month}-01T02:30:00Z`),
        cutoffDate: new Date(`${month}-25T02:30:00Z`),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10.00',
      },
    });
  }

  // ── Submissions.
  async function seedSubmission(c: ClinicDef, month: string, status: SubmissionStatus): Promise<void> {
    const isHistory = month !== CUR;
    const data: Record<string, unknown> = { clinicId: clinicId[c.code], month, status };
    const submittedStates: SubmissionStatus[] = [
      SubmissionStatus.SUBMITTED, SubmissionStatus.CLINIC_MANAGER_REVIEW, SubmissionStatus.CLINIC_APPROVED,
      SubmissionStatus.FINANCE_REVIEW, SubmissionStatus.FINANCE_APPROVED,
      SubmissionStatus.SENT_BACK_BY_MANAGER, SubmissionStatus.SENT_BACK_BY_FINANCE,
    ];
    const managerApprovedStates: SubmissionStatus[] = [
      SubmissionStatus.CLINIC_APPROVED, SubmissionStatus.FINANCE_REVIEW,
      SubmissionStatus.FINANCE_APPROVED, SubmissionStatus.SENT_BACK_BY_FINANCE,
    ];
    if (submittedStates.includes(status)) data.submittedAt = daysAgo(20);
    if (managerApprovedStates.includes(status)) {
      data.approvedByManagerAt = daysAgo(15);
    }
    if (status === SubmissionStatus.FINANCE_APPROVED) {
      data.approvedByFinanceAt = daysAgo(10);
      data.lockedAt = daysAgo(10);
    }
    if (status === SubmissionStatus.CLINIC_MANAGER_REVIEW) {
      data.reviewStartedAt = daysAgo(2);
      data.reviewStartedById = managerId;
    }
    if (status === SubmissionStatus.FINANCE_REVIEW) {
      data.reviewStartedAt = daysAgo(2);
      data.reviewStartedById = financeId;
    }

    const sub = await prisma.monthlySubmission.create({
      data: {
        ...data,
        snapshots: {
          create: HEADS.map((h) => ({
            expenseHeadId: headId[h.key],
            expenseHeadNameAtSnapshot: h.name,
            expenseHeadCategoryAtSnapshot: h.category,
          })),
        },
      } as never,
      include: { snapshots: true },
    });

    // Value every head except for a pristine NOT_STARTED.
    if (status !== SubmissionStatus.NOT_STARTED) {
      for (const snap of sub.snapshots) {
        const head = HEADS.find((h) => h.name === snap.expenseHeadNameAtSnapshot)!;
        await prisma.provisionEntry.create({
          data: {
            submissionId: sub.id,
            snapshotId: snap.id,
            amount: amountFor(c, month, head),
            enteredById: spocId,
            lastModifiedById: spocId,
          },
        });
      }
    }

    if (status === SubmissionStatus.SENT_BACK_BY_MANAGER) {
      await prisma.submissionComment.create({
        data: {
          submissionId: sub.id,
          comment: 'Equipment maintenance looks high vs last month — please double-check the vendor invoice and resubmit.',
          commentedById: managerId,
          roleAtTime: UserRole.CLINIC_MANAGER,
          action: CommentAction.SENT_BACK,
        },
      });
    }
    if (isHistory) {
      // keep history tidy; no-op marker for readability
    }
  }

  for (const c of CLINICS) {
    if (!c.active) {
      // Inactive clinic keeps its history (never deleted) but no current cycle.
      await seedSubmission(c, shiftMonth(CUR, -3), SubmissionStatus.FINANCE_APPROVED);
      await seedSubmission(c, shiftMonth(CUR, -2), SubmissionStatus.FINANCE_APPROVED);
      continue;
    }
    // Three approved historical months for trends/exports + variance baseline.
    await seedSubmission(c, shiftMonth(CUR, -3), SubmissionStatus.FINANCE_APPROVED);
    await seedSubmission(c, shiftMonth(CUR, -2), SubmissionStatus.FINANCE_APPROVED);
    await seedSubmission(c, PRIOR, SubmissionStatus.FINANCE_APPROVED);
    // Current month: the role-spanning status mix.
    await seedSubmission(c, CUR, CURRENT_STATUS[c.code]);
  }

  // ── Summary.
  const counts = {
    clinics: await prisma.clinic.count(),
    heads: await prisma.expenseHead.count(),
    submissions: await prisma.monthlySubmission.count(),
    entries: await prisma.provisionEntry.count(),
  };
  console.log('✔ Demo seed complete');
  console.log(`  months: ${MONTHS.join(', ')} (current = ${CUR})`);
  console.log(`  ${counts.clinics} clinics, ${counts.heads} heads, ${counts.submissions} submissions, ${counts.entries} entries`);
  console.log('  Logins (dev):');
  for (const u of USERS) console.log(`    ${u.role.padEnd(15)} ${u.email}  /  ${u.password}`);
  console.log('  Walkable: SPOC opens Pune (DRAFT) -> submit -> Manager approves -> Finance approves & locks.');
  console.log('  Variance: Equipment Maintenance spikes at Mumbai this month -> flagged on the Finance dashboard.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

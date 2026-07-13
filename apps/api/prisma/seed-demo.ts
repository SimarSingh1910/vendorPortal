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
 * Dev passwords (DEV ONLY). Finance roles span all clinics; each clinic-role
 * user is mapped to EXACTLY ONE clinic (Step 2). Pune uses the friendly logins;
 * other clinics use code-suffixed emails (e.g. spoc.mum@, manager.hyd@).
 *   admin@cpp.local           / Admin@12345    (FINANCE_ADMIN)
 *   finance.manager@cpp.local / FinMgr@12345   (FINANCE_MANAGER)
 *   manager@cpp.local         / Manager@12345  (CLINIC_MANAGER → Pune)
 *   spoc@cpp.local            / Spoc@12345     (CLINIC_SPOC    → Pune)
 *   clinic.viewer@cpp.local   / Clinic@12345   (CLINIC_VIEWER  → Pune)
 *   spoc.<code>@cpp.local     / Spoc@12345     (per-clinic SPOC, e.g. spoc.mum@)
 *   manager.<code>@cpp.local  / Manager@12345  (per-clinic Manager, e.g. manager.hyd@)
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
// Clinics carry a realistic, human-readable Acc. Location Code + Customer Code
// (distinct per clinic) so the finance export shows real identifiers, not the
// migration's PENDING- placeholders.
interface ClinicDef {
  code: string;
  name: string;
  location: string;
  accLocationCode: string;
  customerCode: string;
  factor: number;
  active: boolean;
}
const CLINICS: ClinicDef[] = [
  { code: 'PUN', name: 'Pune Tech Park Clinic', location: 'Pune', accLocationCode: 'PUN-HIN-01', customerCode: 'CUST-100231', factor: 1.0, active: true },
  { code: 'MUM', name: 'Mumbai BKC Clinic', location: 'Mumbai', accLocationCode: 'MUM-BKC-02', customerCode: 'CUST-100232', factor: 1.2, active: true },
  { code: 'BLR', name: 'Bengaluru Whitefield Clinic', location: 'Bengaluru', accLocationCode: 'BLR-WF-03', customerCode: 'CUST-100233', factor: 0.9, active: true },
  { code: 'HYD', name: 'Hyderabad Gachibowli Clinic', location: 'Hyderabad', accLocationCode: 'HYD-GAC-04', customerCode: 'CUST-100234', factor: 1.05, active: true },
  { code: 'CHE', name: 'Chennai OMR Clinic', location: 'Chennai', accLocationCode: 'CHE-OMR-05', customerCode: 'CUST-100235', factor: 0.95, active: true },
  { code: 'GUR', name: 'Gurugram Cyber City Clinic (closed)', location: 'Gurugram', accLocationCode: 'GUR-CYB-06', customerCode: 'CUST-100236', factor: 0.8, active: false },
];

// Expense heads carry realistic G/L account numbers (6xxxxx series) and an
// EXAMPLE per-line vendor / product code / description. Vendor/product/description
// are OPTIONAL by design — the blanks below (e.g. no vendor for salaries, no
// product for equipment) are intentional so the export demos the "may or may not
// be entered" behaviour. `entryExtras` varies them further across clinics/months.
interface HeadDef {
  key: string;
  glAccountNo: string;
  glAccountName: string;
  base: number;
  vendor?: string;
  product?: string;
  description?: string;
}
const HEADS: HeadDef[] = [
  { key: 'RENT', glAccountNo: '610010', glAccountName: 'Facility Rent', base: 120_000, vendor: 'Prestige Property Management', product: 'p10', description: 'Annual lease escalation 5% effective Apr' },
  { key: 'STAFF', glAccountNo: '620010', glAccountName: 'Clinical Staff Salaries', base: 450_000, product: 'p20' },
  { key: 'UTIL', glAccountNo: '630010', glAccountName: 'Utilities (Power & Water)', base: 35_000, vendor: 'BESCOM', product: 'p18', description: 'Higher AC load over summer months' },
  { key: 'CONSUM', glAccountNo: '640010', glAccountName: 'Medical Consumables', base: 80_000, vendor: 'Romsons Scientific & Surgical', product: 'p17' },
  { key: 'HOUSE', glAccountNo: '650010', glAccountName: 'Housekeeping & Sanitation', base: 25_000, vendor: 'BVG India Ltd', product: 'p10', description: 'Additional deep-clean contract' },
  { key: 'EQUIP', glAccountNo: '660010', glAccountName: 'Equipment Maintenance', base: 40_000, vendor: 'Siemens Healthineers', description: 'Scheduled AMC for imaging equipment' }, // the variance spiker
  { key: 'PHARMA', glAccountNo: '670010', glAccountName: 'Pharmacy Stock', base: 95_000, vendor: 'Apollo Pharmacy Distribution', product: 'p17' },
  { key: 'TELECOM', glAccountNo: '680010', glAccountName: 'Internet & Telecom', base: 12_000, vendor: 'Airtel Business', product: 'p18', description: 'Bandwidth upgrade' },
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

// Per-line Vendor Name / Product Code / Description (the Description column maps to
// the per-line SPOC note). All three are OPTIONAL: they start from the head's
// example, then vary by clinic and month so a consolidated export isn't uniform and
// shows the "may or may not be entered" spread (blanks are intentional).
function entryExtras(
  clinic: ClinicDef,
  month: string,
  head: HeadDef,
): { vendorName: string | null; productCode: string | null; note: string | null } {
  const ci = CLINICS.findIndex((x) => x.code === clinic.code);
  const mi = MONTHS.indexOf(month);
  // Vendor names are stable where a vendor is seeded (blank for e.g. staff salaries).
  const vendorName = head.vendor ?? null;
  // Product codes: adopted from the 2nd seeded month onward; some clinics lag a month.
  const productCode = mi >= (ci % 2 === 0 ? 1 : 2) ? head.product ?? null : null;
  // Descriptions are event-driven — only the recent months, and not every clinic.
  const note = mi >= 2 && (ci + mi) % 2 === 0 ? head.description ?? null : null;
  return { vendorName, productCode, note };
}

// ── Users ────────────────────────────────────────────────────────────────────
// Finance roles oversee every clinic and carry NO clinic assignment. Clinic
// roles get EXACTLY ONE clinic each (Step 2) — so a clinic has its own SPOC /
// Manager (+ a Viewer for the walkable clinic), rather than one user spanning
// many clinics. Pune (the walkable clinic) keeps the friendly logins; other
// clinics use code-suffixed emails. Inactive clinics keep their (deactivated)
// staff so historical data stays attributable.
interface UserDef {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  clinicCode?: string;
  active?: boolean;
}

const FINANCE_USERS: UserDef[] = [
  { email: 'admin@cpp.local', password: 'Admin@12345', name: 'Finance Admin', role: UserRole.FINANCE_ADMIN },
  { email: 'finance.manager@cpp.local', password: 'FinMgr@12345', name: 'Finance Manager', role: UserRole.FINANCE_MANAGER },
];

function clinicUsersFor(c: ClinicDef): UserDef[] {
  const code = c.code.toLowerCase();
  const friendly = c.code === 'PUN';
  const users: UserDef[] = [
    { email: friendly ? 'spoc@cpp.local' : `spoc.${code}@cpp.local`, password: 'Spoc@12345', name: `${c.location} SPOC`, role: UserRole.CLINIC_SPOC, clinicCode: c.code, active: c.active },
    { email: friendly ? 'manager@cpp.local' : `manager.${code}@cpp.local`, password: 'Manager@12345', name: `${c.location} Manager`, role: UserRole.CLINIC_MANAGER, clinicCode: c.code, active: c.active },
  ];
  if (friendly) {
    users.push({ email: 'clinic.viewer@cpp.local', password: 'Clinic@12345', name: `${c.location} Viewer`, role: UserRole.CLINIC_VIEWER, clinicCode: c.code, active: c.active });
  }
  return users;
}

const USERS: UserDef[] = [...FINANCE_USERS, ...CLINICS.flatMap(clinicUsersFor)];

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
  const headNames = HEADS.map((h) => h.glAccountName);
  const userEmails = USERS.filter((u) => u.role !== UserRole.FINANCE_ADMIN).map((u) => u.email);
  // Legacy demo emails no longer in USERS (e.g. the pre-Step-1 finance viewer)
  // so re-seeding doesn't leave an orphaned account behind.
  const legacyEmails = ['finance.viewer@cpp.local'];

  // ── Idempotent cleanup (also clears any earlier throwaway 'Demo '/'Perf ' data).
  // Order matters: delete clinics first so submissions → comments / entries /
  // snapshots cascade away (those carry User FKs); only then are the demo users
  // safe to delete (commentedBy / enteredBy are Restrict, not Cascade).
  await prisma.clinic.deleteMany({
    where: { OR: [{ name: { in: clinicNames } }, { name: { startsWith: 'Demo ' } }, { name: { startsWith: 'Perf ' } }] },
  });
  await prisma.expenseHead.deleteMany({
    where: {
      OR: [
        { glAccountName: { in: headNames } },
        { glAccountName: { startsWith: 'Demo ' } },
        { glAccountName: { startsWith: 'Perf ' } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { email: { in: [...userEmails, ...legacyEmails] } } });
  await prisma.notificationConfig.deleteMany({ where: { month: { in: MONTHS } } });

  // ── Clinics + heads + mappings.
  const clinicId: Record<string, string> = {};
  for (const c of CLINICS) {
    const row = await prisma.clinic.create({
      data: {
        name: c.name,
        accLocationCode: c.accLocationCode,
        customerCode: c.customerCode,
        isActive: c.active,
      },
    });
    clinicId[c.code] = row.id;
  }
  const headId: Record<string, string> = {};
  for (const h of HEADS) {
    const row = await prisma.expenseHead.create({
      data: { glAccountNo: h.glAccountNo, glAccountName: h.glAccountName, isActive: true },
    });
    headId[h.key] = row.id;
  }
  for (const c of CLINICS) {
    await prisma.clinicExpenseHead.createMany({
      data: HEADS.map((h) => ({ clinicId: clinicId[c.code], expenseHeadId: headId[h.key], isActive: true })),
    });
  }

  // ── Users with their single clinic assignment. Track SPOC/Manager per clinic
  // so each clinic's submissions are authored by that clinic's own staff.
  const spocByCode: Record<string, string> = {};
  const managerByCode: Record<string, string> = {};
  let financeId = '';
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, ROUNDS);
    const assignData = u.clinicCode ? [{ clinicId: clinicId[u.clinicCode] }] : [];
    const isActive = u.active ?? true;
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, isActive, passwordHash, tokenVersion: { increment: 1 }, assignments: { deleteMany: {}, create: assignData } },
      create: { email: u.email, name: u.name, role: u.role, isActive, passwordHash, assignments: { create: assignData } },
    });
    if (u.role === UserRole.CLINIC_SPOC && u.clinicCode) spocByCode[u.clinicCode] = row.id;
    if (u.role === UserRole.CLINIC_MANAGER && u.clinicCode) managerByCode[u.clinicCode] = row.id;
    if (u.role === UserRole.FINANCE_ADMIN) financeId = row.id;
  }

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
      data.reviewStartedById = managerByCode[c.code];
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
            expenseHeadGlNameAtSnapshot: h.glAccountName,
            expenseHeadGlNoAtSnapshot: h.glAccountNo,
          })),
        },
      } as never,
      include: { snapshots: true },
    });

    // Value every head except for a pristine NOT_STARTED.
    if (status !== SubmissionStatus.NOT_STARTED) {
      for (const snap of sub.snapshots) {
        const head = HEADS.find((h) => h.glAccountName === snap.expenseHeadGlNameAtSnapshot)!;
        const extras = entryExtras(c, month, head);
        await prisma.provisionEntry.create({
          data: {
            submissionId: sub.id,
            snapshotId: snap.id,
            amount: amountFor(c, month, head),
            vendorName: extras.vendorName,
            productCode: extras.productCode,
            note: extras.note,
            enteredById: spocByCode[c.code],
            lastModifiedById: spocByCode[c.code],
          },
        });
      }
    }

    if (status === SubmissionStatus.SENT_BACK_BY_MANAGER) {
      await prisma.submissionComment.create({
        data: {
          submissionId: sub.id,
          comment: 'Equipment maintenance looks high vs last month — please double-check the vendor invoice and resubmit.',
          commentedById: managerByCode[c.code],
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
  console.log('  Logins (dev) — finance roles span all clinics; clinic roles map to one clinic:');
  for (const u of USERS) {
    const where = u.clinicCode ? ` [${u.clinicCode}]` : '';
    const inactive = u.active === false ? ' (inactive)' : '';
    console.log(`    ${u.role.padEnd(15)} ${u.email.padEnd(28)} /  ${u.password}${where}${inactive}`);
  }
  console.log('  Walkable: spoc@ opens Pune (DRAFT) -> submit -> manager@ approves -> Finance approves & locks.');
  console.log('  Variance: Equipment Maintenance spikes at Mumbai this month -> flagged on the Finance dashboard.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

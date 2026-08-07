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
  customerName: string;
  factor: number;
  active: boolean;
}
const CLINICS: ClinicDef[] = [
  { code: 'PUN', name: 'Pune Tech Park Clinic', location: 'Pune', accLocationCode: 'PUN-HIN-01', customerCode: 'CUST-100231', customerName: 'Demo Customer — Pune', factor: 1.0, active: true },
  { code: 'MUM', name: 'Mumbai BKC Clinic', location: 'Mumbai', accLocationCode: 'MUM-BKC-02', customerCode: 'CUST-100232', customerName: 'Demo Customer — Mumbai', factor: 1.2, active: true },
  { code: 'BLR', name: 'Bengaluru Whitefield Clinic', location: 'Bengaluru', accLocationCode: 'BLR-WF-03', customerCode: 'CUST-100233', customerName: 'Demo Customer — Bengaluru', factor: 0.9, active: true },
  { code: 'HYD', name: 'Hyderabad Gachibowli Clinic', location: 'Hyderabad', accLocationCode: 'HYD-GAC-04', customerCode: 'CUST-100234', customerName: 'Demo Customer — Hyderabad', factor: 1.05, active: true },
  { code: 'CHE', name: 'Chennai OMR Clinic', location: 'Chennai', accLocationCode: 'CHE-OMR-05', customerCode: 'CUST-100235', customerName: 'Demo Customer — Chennai', factor: 0.95, active: true },
  { code: 'GUR', name: 'Gurugram Cyber City Clinic (closed)', location: 'Gurugram', accLocationCode: 'GUR-CYB-06', customerCode: 'CUST-100236', customerName: 'Demo Customer — Gurugram', factor: 0.8, active: false },
];

// Expense heads carry realistic G/L account numbers (6xxxxx series) and an
// EXAMPLE per-line vendor / product code / description. Vendor name AND product
// code are both REQUIRED (submit rejects a line missing either), so every head
// below carries both — seeded submissions must be data the workflow would actually
// have accepted. Only the description (the per-particular remark) stays OPTIONAL,
// and `entryExtras` varies it across clinics/months so the export still demos the
// "may or may not be entered" spread.
interface HeadDef {
  key: string;
  glAccountNo: string;
  glAccountName: string;
  base: number;
  /** REQUIRED — a vendor line cannot be submitted without a vendor name. */
  vendor: string;
  /** REQUIRED — a vendor line cannot be submitted without a product code. */
  product: string;
  description?: string;
  /** Heads flagged multi-vendor in the finance sheet accept several lines per submission. */
  allowsMultipleVendors?: boolean;
  /** A second demo vendor line for a multi-vendor head (seeds real multi-line data). */
  vendor2?: string;
}
// The 15 real clinic G/L accounts (from the finance sheet). glAccountNo is a CODE
// stored as a string — never an integer, never reformatted. Names are verbatim
// (including their original capitalisation/spacing, e.g. "House keeping and
// maintenance", "Rent - building for Dental") — do not "correct" them. Vendor and
// product code are always set (both are mandatory at submit); only the description
// mix is left partly BLANK, so the export still demos the "may or may not be
// entered" spread. RADIOLOGY is the variance spiker (see amountFor).
const HEADS: HeadDef[] = [
  { key: 'CCHIRE', glAccountNo: '41402005', glAccountName: 'Credit Card Machine Hire Charges', base: 8_000, vendor: 'Pine Labs', product: 'P10', description: 'Two additional POS terminals installed' },
  { key: 'OUTSVC', glAccountNo: '41117004', glAccountName: 'Other Outsourced Services', base: 60_000, vendor: 'Quess Corp', product: 'P20', allowsMultipleVendors: true, vendor2: 'Sodexo Facilities' },
  { key: 'BIOWASTE', glAccountNo: '41117002', glAccountName: 'Biomedical Waste Services', base: 15_000, vendor: 'SembRamky Environmental', product: 'P17' },
  { key: 'AMBUL', glAccountNo: '41117001', glAccountName: 'Ambulance Services', base: 30_000, vendor: 'Ziqitza Healthcare' , product: 'P27' },
  { key: 'REFRESH', glAccountNo: '41115013', glAccountName: 'Refreshment for patients', base: 12_000, vendor: 'Nestle Professional', product: 'P18' },
  { key: 'POSTAGE', glAccountNo: '41115009', glAccountName: 'Postage and courier charges', base: 5_000, vendor: 'Blue Dart', product: 'P10' },
  { key: 'HOUSE', glAccountNo: '41115002', glAccountName: 'House keeping and maintenance', base: 25_000, vendor: 'BVG India Ltd', product: 'P20', description: 'Additional deep-clean contract' },
  { key: 'LAUNDRY', glAccountNo: '41109004', glAccountName: 'Laundry Expenses', base: 18_000, vendor: 'UClean' , product: 'P20' },
  { key: 'DENTRENT', glAccountNo: '41107001', glAccountName: 'Rent - building for Dental', base: 120_000, vendor: 'Prestige Property Management', product: 'P21', description: 'Annual lease escalation 5% effective Apr' },
  { key: 'RADIOLOGY', glAccountNo: '41104016', glAccountName: 'Radiology Services', base: 55_000, vendor: 'Siemens Healthineers', product: 'P27', description: 'Scheduled AMC for imaging equipment' }, // the variance spiker
  { key: 'CONSUM', glAccountNo: '41104002', glAccountName: 'Consumables common', base: 80_000, vendor: 'Romsons Scientific & Surgical', product: 'P17' },
  { key: 'TELECOM', glAccountNo: '41103001', glAccountName: 'Telephone/Mobile expenses', base: 12_000, vendor: 'Airtel Business', product: 'P18', description: 'Bandwidth upgrade' },
  { key: 'WELFARE', glAccountNo: '41003001', glAccountName: 'Staff welfare expense', base: 40_000, vendor: 'Sodexo BRS India', product: 'P20' },
  { key: 'LOCUM', glAccountNo: '41002007', glAccountName: 'Locum', base: 90_000, vendor: 'Medanta Locum Services', product: 'P17', allowsMultipleVendors: true, vendor2: 'Apollo Locum Pool' },
  { key: 'EVENTS', glAccountNo: '41112001', glAccountName: 'Events and exhibitions - Domestic', base: 20_000, vendor: 'Cvent India', product: 'P27', description: 'Quarterly community health camp', allowsMultipleVendors: true, vendor2: 'Local Event Partners' },
];

// Per (clinic, month, head) amount. Historical months drift up slightly; the
// current month mirrors the prior month so only the deliberate spike moves —
// Radiology Services at Mumbai jumps ~2.4x, tripping the variance flag.
function amountFor(clinic: ClinicDef, month: string, head: HeadDef): number {
  const isCurrent = month === CUR;
  const rank = MONTHS.indexOf(month);
  const growth = isCurrent ? 1 + 0.02 * (MONTHS.length - 2) : 1 + 0.02 * rank;
  let amt = head.base * clinic.factor * growth;
  if (isCurrent && head.key === 'RADIOLOGY' && clinic.code === 'MUM') {
    amt = head.base * clinic.factor * 2.4;
  }
  return Math.round(amt);
}

/**
 * Break a vendor line's target amount into 2 realistic rate × quantity particulars.
 *
 * The FIRST row is a plausible unit-price × units pair; the SECOND absorbs whatever
 * is left as a single unit, so the particulars sum to the target EXACTLY. That
 * matters: the demo's dashboards, variance thresholds and exports are all tuned to
 * these amounts, and a line's amount is now the sum of its particulars — so if the
 * split didn't reconcile to the penny, the seeded figures would silently shift.
 */
function particularsFor(
  headName: string,
  amount: number,
  /** Optional SPOC remark — seeded on the FIRST particular only (see entryExtras). */
  remark: string | null = null,
): Array<{
  lineOrder: number;
  particularName: string;
  rate: string;
  quantity: string;
  value: string;
  remark: string | null;
}> {
  const totalPaise = Math.round(amount * 100);
  // ~60% of the line across a whole number of units, at a 2-dp unit rate.
  const units = 12;
  const firstRatePaise = Math.floor((totalPaise * 0.6) / units);
  const firstValuePaise = firstRatePaise * units;
  const restPaise = totalPaise - firstValuePaise;
  const money = (paise: number) => (paise / 100).toFixed(2);

  return [
    {
      lineOrder: 0,
      particularName: `${headName} — monthly units`,
      rate: money(firstRatePaise),
      quantity: String(units),
      value: money(firstValuePaise),
      remark,
    },
    {
      lineOrder: 1,
      particularName: `${headName} — balance / one-off`,
      rate: money(restPaise),
      quantity: '1',
      value: money(restPaise),
      remark: null,
    },
  ];
}

// Per-line Vendor Name / Product Code, plus the SPOC remark that the export's
// trailing Remarks column reads (seeded on the line's FIRST particular). Vendor and
// product are both mandatory at submit, so both are always populated; only the
// remark is optional, and it varies by clinic and month so a consolidated export
// isn't uniform and shows the "may or may not be entered" spread.
function entryExtras(
  clinic: ClinicDef,
  month: string,
  head: HeadDef,
): { vendorName: string; productCode: string; remark: string | null } {
  const ci = CLINICS.findIndex((x) => x.code === clinic.code);
  const mi = MONTHS.indexOf(month);
  // Vendor name is MANDATORY per vendor line — always populated, never blank.
  const vendorName = head.vendor;
  // Product code is MANDATORY per vendor line — always populated, never blank.
  const productCode = head.product;
  // Descriptions are event-driven — only the recent months, and not every clinic.
  const remark = mi >= 2 && (ci + mi) % 2 === 0 ? head.description ?? null : null;
  return { vendorName, productCode, remark };
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
  // ExpenseHead is clinic-only master data owned by this demo seed (corporate uses
  // the separate CorpExpenseHead model), so a full reset is safe here — and it
  // also clears any legacy `TEMP-<id>` placeholder heads (and throwaway Demo/Perf
  // rows) so the master ends at exactly the 15 real G/L accounts above. Runs after
  // the clinic delete, so every referencing snapshot has already cascaded away.
  await prisma.expenseHead.deleteMany({});
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
        customerName: c.customerName,
        isActive: c.active,
      },
    });
    clinicId[c.code] = row.id;
  }
  const headId: Record<string, string> = {};
  for (const h of HEADS) {
    const row = await prisma.expenseHead.create({
      data: {
        glAccountNo: h.glAccountNo,
        glAccountName: h.glAccountName,
        allowsMultipleVendors: h.allowsMultipleVendors ?? false,
        isActive: true,
      },
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
            expenseHeadAllowsMultipleVendorsAtSnapshot: h.allowsMultipleVendors ?? false,
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
        const primary = amountFor(c, month, head);
        await prisma.provisionEntry.create({
          data: {
            submissionId: sub.id,
            snapshotId: snap.id,
            lineOrder: 0,
            amount: primary,
            vendorName: extras.vendorName,
            productCode: extras.productCode,
            enteredById: spocByCode[c.code],
            lastModifiedById: spocByCode[c.code],
            particulars: {
              create: particularsFor(head.glAccountName, primary, extras.remark),
            },
          },
        });
        // A multi-vendor head carries a SECOND vendor line (~40% of the first) so
        // the demo has real multi-line data whose per-head total sums both lines.
        if (head.allowsMultipleVendors && head.vendor2) {
          const secondary = Math.round(primary * 0.4);
          await prisma.provisionEntry.create({
            data: {
              submissionId: sub.id,
              snapshotId: snap.id,
              lineOrder: 1,
              amount: secondary,
              vendorName: head.vendor2,
              productCode: head.product,
              enteredById: spocByCode[c.code],
              lastModifiedById: spocByCode[c.code],
              particulars: { create: particularsFor(head.glAccountName, secondary) },
            },
          });
        }
      }
    }

    if (status === SubmissionStatus.SENT_BACK_BY_MANAGER) {
      await prisma.submissionComment.create({
        data: {
          submissionId: sub.id,
          comment: 'Radiology services look high vs last month — please double-check the vendor invoice and resubmit.',
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
  console.log('  Variance: Radiology Services spikes at Mumbai this month -> flagged on the Finance dashboard.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

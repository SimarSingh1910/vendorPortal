/**
 * Corporate Provisions RICH demo seed (dev only). Seeds the BRD Section 2 set of
 * EXACTLY 14 departments (verbatim names + types — do not invent or rename),
 * each with its own expense heads + budget codes, then drives the REAL services
 * (cycle open → entry → submit → review → approve) to populate several months of
 * submissions across every workflow state.
 *
 * IMPORTANT — drives the REAL services, never raw inserts for the workflow:
 *   masters  → prisma upsert-by-name for departments (verbatim type, idempotent),
 *              Corp{ExpenseHeads,BudgetCodes} services for heads/codes
 *   users    → UsersService (multi-dept assignment, session invalidation)
 *   Sec 24   → Sec24AllocationService.setAllocation (append-only %)
 *   cycle    → CorpCycleService.openDepartmentCycle (active-head SNAPSHOT)
 *   entry    → CorpProvisionEntryService.saveEntries (budget-code validation)
 *   workflow → CorpWorkflowService.{submit,openReview,approve,sendBack}
 * so snapshots, the frozen per-line hclAvitasShare and sec24PctSnapshot come out
 * EXACTLY as production produces them.
 *
 * Idempotent + self-reconciling: removes ALL corporate submission/master DEPENDENT
 * rows, deletes any ORPHAN department (a name not in the BRD 14 — including ones
 * earlier seeds created under placeholder names), then UPSERTS the 14 by name so a
 * re-run leaves exactly these 14 with no duplicates / renamed copies / orphans.
 *
 * The single SHARED_COST_POOL is #14 (Sec 24); the single INTERNAL_BU is #4
 * (Tulip); the other 12 are STANDARD. The Sec 24 % is set effective from CUR-2, so
 * the pool has approved months BEFORE any % (share stays NULL — NULL ≠ 0) AND
 * approved months WITH a frozen % snapshot.
 *
 * Runs against the COMPILED dist (kept fresh by `nest start --watch`, or built by
 * the prisma:seed:corp-rich script) so the DI metadata is present.
 */
import { createRequire } from 'node:module';
import { NestFactory } from '@nestjs/core';
import { CorpDepartmentType, UserRole } from '@prisma/client';

// Resolve compiled app + providers from dist (relative to dist/prisma/<this file>).
const dist = createRequire(__filename);
/* eslint-disable @typescript-eslint/no-var-requires */
const { AppModule } = dist('../app.module');
const { PrismaService } = dist('../prisma/prisma.service');
const { CorpExpenseHeadsService } = dist('../corp-expense-heads/corp-expense-heads.service');
const { CorpBudgetCodesService } = dist('../corp-budget-codes/corp-budget-codes.service');
const { Sec24AllocationService } = dist('../corp-submissions/sec24-allocation.service');
const { CorpCycleService } = dist('../corp-submissions/corp-cycle.service');
const { CorpProvisionEntryService } = dist('../corp-submissions/corp-provision-entry.service');
const { CorpWorkflowService } = dist('../corp-submissions/corp-workflow.service');
const { UsersService } = dist('../users/users.service');
/* eslint-enable @typescript-eslint/no-var-requires */

function currentMonthIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const CUR = currentMonthIST();
const HISTORY = 4; // fully-approved prior months: CUR-4 … CUR-1
const HIST_MONTHS = Array.from({ length: HISTORY }, (_, i) => shiftMonth(CUR, -(HISTORY - i)));
const SEC24_EFFECTIVE_FROM = shiftMonth(CUR, -2); // % begins here → CUR-4/CUR-3 stay NULL
const SEC24_PCT = 60;

/** A synthetic authenticated principal for service calls (no HTTP request). */
interface SeedUser {
  id: string;
  email: string;
  role: UserRole;
  clinicIds: string[];
  tokenVersion: number;
}
const asUser = (id: string, email: string, role: UserRole): SeedUser => ({
  id,
  email,
  role,
  clinicIds: [],
  tokenVersion: 0,
});

/** Current-month workflow state to leave a department in (covers all six). */
type CurState =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'FINANCE_MANAGER_REVIEW'
  | 'SENT_BACK_TO_SPOC'
  | 'FINANCE_APPROVED';

interface DeptDef {
  key: string;
  name: string;
  type: CorpDepartmentType;
  heads: string[];
  codes: { code: string; description: string }[];
  base: number[]; // per-head baseline monthly provision (aligned to heads)
  curState: CurState;
}

/**
 * BRD Section 2 — EXACTLY 14 departments, verbatim names + types. Exactly one
 * SHARED_COST_POOL (#14) and one INTERNAL_BU (#4); the other 12 are STANDARD.
 */
const DEPARTMENTS: DeptDef[] = [
  {
    key: 'IT',
    name: 'IT - Tech',
    type: CorpDepartmentType.STANDARD,
    heads: ['Cloud Infrastructure', 'Software Licenses', 'Hardware & Devices'],
    codes: [
      { code: 'IT-OPX', description: 'IT operating expenditure' },
      { code: 'IT-CAP', description: 'IT capital expenditure' },
    ],
    base: [820000, 460000, 310000],
    curState: 'SUBMITTED',
  },
  {
    key: 'HR',
    name: 'HR',
    type: CorpDepartmentType.STANDARD,
    heads: ['Recruitment', 'Employee Welfare', 'Payroll Services'],
    codes: [
      { code: 'HR-OPX', description: 'HR operating expenditure' },
      { code: 'HR-WEL', description: 'Employee welfare' },
    ],
    base: [240000, 150000, 95000],
    curState: 'FINANCE_MANAGER_REVIEW',
  },
  {
    key: 'TRN',
    name: 'Training - Learning & Development',
    type: CorpDepartmentType.STANDARD,
    heads: ['Course Content', 'Trainer Fees', 'Certifications'],
    codes: [
      { code: 'TRN-OPX', description: 'Training operating expenditure' },
      { code: 'TRN-MAT', description: 'Training materials' },
    ],
    base: [180000, 220000, 90000],
    curState: 'DRAFT',
  },
  {
    key: 'TULIP',
    name: 'Tulip',
    type: CorpDepartmentType.INTERNAL_BU,
    heads: ['Operations', 'Field Staff', 'Logistics'],
    codes: [
      { code: 'TUL-OPX', description: 'Tulip operating expenditure' },
      { code: 'TUL-CAP', description: 'Tulip capital expenditure' },
    ],
    base: [520000, 410000, 175000],
    curState: 'NOT_STARTED',
  },
  {
    key: 'CARE',
    name: 'Care Plan',
    type: CorpDepartmentType.STANDARD,
    heads: ['Plan Administration', 'Member Servicing', 'Network Costs'],
    codes: [
      { code: 'CP-OPX', description: 'Care Plan operating expenditure' },
      { code: 'CP-NET', description: 'Network costs' },
    ],
    base: [300000, 210000, 260000],
    curState: 'SENT_BACK_TO_SPOC',
  },
  {
    key: 'MKT',
    name: 'Marketing',
    type: CorpDepartmentType.STANDARD,
    heads: ['Digital Campaigns', 'Events & Sponsorships', 'Brand & Creative'],
    codes: [
      { code: 'MKT-OPX', description: 'Marketing operating expenditure' },
      { code: 'MKT-CMP', description: 'Campaign spend' },
    ],
    base: [430000, 260000, 140000],
    curState: 'FINANCE_APPROVED',
  },
  {
    key: 'PRD',
    name: 'Product',
    type: CorpDepartmentType.STANDARD,
    heads: ['Product Development', 'UX Research', 'Tooling'],
    codes: [
      { code: 'PRD-OPX', description: 'Product operating expenditure' },
      { code: 'PRD-CAP', description: 'Product capital expenditure' },
    ],
    base: [560000, 180000, 120000],
    curState: 'SUBMITTED',
  },
  {
    key: 'VAS',
    name: 'VAS - Value Added Services',
    type: CorpDepartmentType.STANDARD,
    heads: ['Partner Services', 'Content Licensing', 'Support'],
    codes: [
      { code: 'VAS-OPX', description: 'VAS operating expenditure' },
      { code: 'VAS-PRT', description: 'Partner costs' },
    ],
    base: [275000, 160000, 130000],
    curState: 'FINANCE_MANAGER_REVIEW',
  },
  {
    key: 'SALES',
    name: 'Corp - Sales (Other than Lab)',
    type: CorpDepartmentType.STANDARD,
    heads: ['Field Sales', 'Travel & Entertainment', 'Commissions'],
    codes: [
      { code: 'SAL-OPX', description: 'Sales operating expenditure' },
      { code: 'SAL-COM', description: 'Commissions' },
    ],
    base: [610000, 290000, 350000],
    curState: 'DRAFT',
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    type: CorpDepartmentType.STANDARD,
    heads: ['Office Supplies', 'Insurance', 'Statutory Fees'],
    codes: [
      { code: 'ADM-OPX', description: 'Admin operating expenditure' },
      { code: 'ADM-PROF', description: 'Professional fees' },
    ],
    base: [120000, 240000, 180000],
    curState: 'NOT_STARTED',
  },
  {
    key: 'PROC',
    name: 'Procurement',
    type: CorpDepartmentType.STANDARD,
    heads: ['Vendor Management', 'Sourcing', 'Inventory Costs'],
    codes: [
      { code: 'PRC-OPX', description: 'Procurement operating expenditure' },
      { code: 'PRC-INV', description: 'Inventory' },
    ],
    base: [210000, 175000, 320000],
    curState: 'SENT_BACK_TO_SPOC',
  },
  {
    key: 'CALL',
    name: 'Call Center',
    type: CorpDepartmentType.STANDARD,
    heads: ['Telephony', 'Agent Staffing', 'CRM Tools'],
    codes: [
      { code: 'CC-OPX', description: 'Call Center operating expenditure' },
      { code: 'CC-TEL', description: 'Telephony' },
    ],
    base: [160000, 540000, 110000],
    curState: 'FINANCE_APPROVED',
  },
  {
    key: 'WELL',
    name: 'Well Being',
    type: CorpDepartmentType.STANDARD,
    heads: ['Wellness Programs', 'Counselling', 'Health Camps'],
    codes: [
      { code: 'WB-OPX', description: 'Well Being operating expenditure' },
      { code: 'WB-PRG', description: 'Programs' },
    ],
    base: [140000, 90000, 130000],
    curState: 'SUBMITTED',
  },
  {
    key: 'SEC24',
    name: 'Sec 24 Building Expenses - Shared',
    type: CorpDepartmentType.SHARED_COST_POOL,
    heads: ['Rent & Lease', 'Utilities', 'Security Services', 'Housekeeping & Maintenance'],
    codes: [
      { code: 'SEC24-SHARED', description: 'Shared building cost pool' },
      { code: 'SEC24-FAC', description: 'Facilities management' },
    ],
    base: [900000, 420000, 260000, 180000],
    curState: 'FINANCE_APPROVED',
  },
];

const BRD_NAMES = new Set(DEPARTMENTS.map((d) => d.name));

const EMAILS = [
  'corp.spoc@cpp.local',
  'corp.finance@cpp.local',
  'corp.viewer@cpp.local',
  'corp.spoc.it@cpp.local',
  'corp.spoc.hr@cpp.local',
  'corp.viewer.ss@cpp.local',
];

/** Per-head amount for a department in a given month offset (0 = current). */
function amountFor(d: DeptDef, headIdx: number, monthsAgo: number): number {
  const monthsElapsed = HISTORY - monthsAgo; // grows ~2%/month off the baseline
  return Math.round(d.base[headIdx] * (1 + 0.02 * monthsElapsed));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reconcile to exactly the 14 BRD departments: wipe ALL corporate dependent rows
 * (so the workflow rebuild is clean + idempotent), then drop any ORPHAN department
 * whose name isn't in the BRD set. The 14 themselves are upserted by name later.
 */
async function reconcile(prisma: any): Promise<void> {
  const all = await prisma.corpDepartment.findMany({ select: { id: true, name: true } });
  const allIds = all.map((d: any) => d.id);

  if (allIds.length) {
    const subs = await prisma.corpMonthlySubmission.findMany({
      where: { departmentId: { in: allIds } },
      select: { id: true },
    });
    const subIds = subs.map((s: any) => s.id);
    if (subIds.length) {
      await prisma.corpProvisionEntry.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.corpSubmissionComment.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.corpSubmissionExpenseHeadSnapshot.deleteMany({
        where: { submissionId: { in: subIds } },
      });
      await prisma.corpMonthlySubmission.deleteMany({ where: { id: { in: subIds } } });
    }
    await prisma.corpBudgetCode.deleteMany({ where: { departmentId: { in: allIds } } });
    await prisma.corpExpenseHead.deleteMany({ where: { departmentId: { in: allIds } } });
    await prisma.userDepartmentAssignment.deleteMany({ where: { departmentId: { in: allIds } } });

    // Orphans: any department whose name isn't one of the BRD 14.
    const orphanIds = all.filter((d: any) => !BRD_NAMES.has(d.name)).map((d: any) => d.id);
    if (orphanIds.length) {
      await prisma.corpDepartment.deleteMany({ where: { id: { in: orphanIds } } });
    }
  }

  // Reset the global Sec 24 % history + the seed's users.
  await prisma.sec24AllocationConfig.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const headsSvc = app.get(CorpExpenseHeadsService);
    const codesSvc = app.get(CorpBudgetCodesService);
    const sec24Svc = app.get(Sec24AllocationService);
    const cycleSvc = app.get(CorpCycleService);
    const entrySvc = app.get(CorpProvisionEntryService);
    const workflowSvc = app.get(CorpWorkflowService);
    const usersSvc = app.get(UsersService);

    await reconcile(prisma);

    // ── Upsert the 14 departments by name (verbatim type), then heads + codes. ──
    const deptId: Record<string, string> = {};
    const codeIds: Record<string, string[]> = {};
    for (const d of DEPARTMENTS) {
      const existing = await prisma.corpDepartment.findFirst({ where: { name: d.name } });
      const dept = existing
        ? await prisma.corpDepartment.update({
            where: { id: existing.id },
            data: { type: d.type, isActive: true },
          })
        : await prisma.corpDepartment.create({ data: { name: d.name, type: d.type } });
      deptId[d.key] = dept.id;
      for (const name of d.heads) {
        await headsSvc.create(dept.id, { name });
      }
      codeIds[d.key] = [];
      for (const c of d.codes) {
        const bc = await codesSvc.create(dept.id, { code: c.code, description: c.description });
        codeIds[d.key].push(bc.id);
      }
    }

    // ── Users via UsersService. ──────────────────────────────────────────────
    const spocAll = await usersSvc.create({
      name: 'Corporate SPOC',
      email: 'corp.spoc@cpp.local',
      password: 'Spoc@12345',
      role: UserRole.DEPT_SPOC,
      departmentIds: DEPARTMENTS.map((d) => deptId[d.key]),
    });
    const finMgr = await usersSvc.create({
      name: 'Corporate Finance Manager',
      email: 'corp.finance@cpp.local',
      password: 'FinMgr@12345',
      role: UserRole.CORP_FINANCE_MANAGER,
    });
    await usersSvc.create({
      name: 'Corporate Viewer',
      email: 'corp.viewer@cpp.local',
      password: 'Clinic@12345',
      role: UserRole.DEPT_VIEWER,
      departmentIds: [deptId.IT],
    });
    await usersSvc.create({
      name: 'IT Department SPOC',
      email: 'corp.spoc.it@cpp.local',
      password: 'Spoc@12345',
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptId.IT],
    });
    await usersSvc.create({
      name: 'HR Department SPOC',
      email: 'corp.spoc.hr@cpp.local',
      password: 'Spoc@12345',
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptId.HR],
    });
    await usersSvc.create({
      name: 'Shared Services Viewer',
      email: 'corp.viewer.ss@cpp.local',
      password: 'Clinic@12345',
      role: UserRole.DEPT_VIEWER,
      departmentIds: [deptId.SEC24],
    });

    const spoc = asUser(spocAll.id, 'corp.spoc@cpp.local', UserRole.DEPT_SPOC);
    const fin = asUser(finMgr.id, 'corp.finance@cpp.local', UserRole.CORP_FINANCE_MANAGER);

    // ── Finance Admin owns the Sec 24 % (reuse seed-admin's, else create one). ─
    let adminRow = await prisma.user.findUnique({ where: { email: 'admin@cpp.local' } });
    if (!adminRow) {
      const created = await usersSvc.create({
        name: 'Finance Admin',
        email: 'admin@cpp.local',
        password: 'Admin@12345',
        role: UserRole.FINANCE_ADMIN,
      });
      adminRow = await prisma.user.findUnique({ where: { id: created.id } });
    }
    const admin = asUser(adminRow.id, adminRow.email, UserRole.FINANCE_ADMIN);

    // ── Sec 24 %: effective only from CUR-2, so approvals in CUR-4/CUR-3 freeze a
    //    NULL share (NULL ≠ 0) and CUR-2/CUR-1 freeze the 60% snapshot. ─────────
    await sec24Svc.setAllocation(admin, {
      allocationPct: SEC24_PCT,
      effectiveFromMonth: SEC24_EFFECTIVE_FROM,
      notes: '[rich-demo] Sec 24 shared-cost allocation',
    });

    // ── Per-cycle CORPORATE notification config for every month (variance + calendar).
    for (const month of [...HIST_MONTHS, CUR]) {
      const existing = await prisma.notificationConfig.findUnique({
        where: { month_portal: { month, portal: 'CORPORATE' } },
      });
      if (!existing) {
        await prisma.notificationConfig.create({
          data: {
            portal: 'CORPORATE',
            month,
            monthStartNotifyDate: new Date(`${month}-01T02:30:00Z`),
            cutoffDate: new Date(`${month}-25T02:30:00Z`),
            preCutoffReminderDays: 3,
            varianceThresholdPercent: '10.00',
          },
        });
      }
    }

    const enterAll = async (d: DeptDef, submission: any, monthsAgo: number) => {
      const codes = codeIds[d.key];
      const items = submission.snapshots.map((snap: any) => {
        const idx = d.heads.indexOf(snap.expenseHeadNameAtSnapshot);
        return {
          snapshotId: snap.id,
          budgetCodeId: codes[idx % codes.length],
          amount: amountFor(d, idx, monthsAgo),
        };
      });
      await entrySvc.saveEntries(submission.id, spoc, items);
    };

    // ── Fully-approved HISTORY: open → enter → submit → openReview → approve. ──
    for (const d of DEPARTMENTS) {
      for (let i = 0; i < HIST_MONTHS.length; i++) {
        const month = HIST_MONTHS[i];
        const monthsAgo = HISTORY - i;
        const { submission } = await cycleSvc.openDepartmentCycle(deptId[d.key], month);
        await enterAll(d, submission, monthsAgo);
        await workflowSvc.submit(submission.id, spoc, `Provision for ${month}.`);
        await workflowSvc.openReview(submission.id, fin);
        await workflowSvc.approve(submission.id, fin, 'Approved.');
      }
    }

    // ── CURRENT month: open every department, then walk each to its target state. ──
    for (const d of DEPARTMENTS) {
      const { submission } = await cycleSvc.openDepartmentCycle(deptId[d.key], CUR);
      const id = submission.id;
      const target = d.curState;

      if (target === 'NOT_STARTED') continue;

      if (target === 'DRAFT') {
        const codes = codeIds[d.key];
        const first = submission.snapshots[0];
        const idx = d.heads.indexOf(first.expenseHeadNameAtSnapshot);
        await entrySvc.saveEntries(id, spoc, [
          { snapshotId: first.id, budgetCodeId: codes[idx % codes.length], amount: amountFor(d, idx, 0) },
        ]);
        continue;
      }

      await enterAll(d, submission, 0);
      await workflowSvc.submit(id, spoc, `Provision for ${CUR}.`);
      if (target === 'SUBMITTED') continue;

      await workflowSvc.openReview(id, fin);
      if (target === 'FINANCE_MANAGER_REVIEW') continue;

      if (target === 'SENT_BACK_TO_SPOC') {
        await workflowSvc.sendBack(id, fin, 'Please revise and provide a breakup.');
        continue;
      }
      if (target === 'FINANCE_APPROVED') {
        await workflowSvc.approve(id, fin, 'Approved and locked.');
        continue;
      }
    }

    const stdCount = DEPARTMENTS.filter((d) => d.type === CorpDepartmentType.STANDARD).length;
    console.log('✔ Corporate RICH demo data ready — BRD Section 2 (14 departments)');
    console.log(`  departments:   ${DEPARTMENTS.length} total (${stdCount} STANDARD + 1 INTERNAL_BU + 1 SHARED_COST_POOL)`);
    console.log(`  history:       ${HIST_MONTHS[0]} … ${HIST_MONTHS[HIST_MONTHS.length - 1]} (all approved) · current ${CUR} spans all states`);
    console.log(`  Sec 24 %:      ${SEC24_PCT}% from ${SEC24_EFFECTIVE_FROM} → CUR-4/CUR-3 approved with NULL share, CUR-2/CUR-1 with frozen ${SEC24_PCT}%`);
    console.log('  logins (dev):  corp.spoc@cpp.local / Spoc@12345 (all 14 depts) · corp.finance@cpp.local / FinMgr@12345');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

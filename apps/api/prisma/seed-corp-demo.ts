/**
 * Corporate Provisions demo seed (CF.2, dev only). Companion to seed-demo.ts
 * (clinic-only) so the Corporate tab can be exercised end to end in a browser.
 *
 * IMPORTANT — drives the REAL services, never raw inserts. It boots the Nest
 * application context and runs the actual production code paths:
 *   masters  → CorpDepartments/ExpenseHeads/BudgetCodes services
 *   users    → UsersService (multi-dept assignment, session invalidation)
 *   Sec 24   → Sec24AllocationService.setAllocation (append-only %)
 *   cycle    → CorpCycleService.openDepartmentCycle (active-head SNAPSHOT)
 *   entry    → CorpProvisionEntryService.saveEntries (budget-code validation)
 *   workflow → CorpWorkflowService.submit → openReview → approve
 * so snapshots, the frozen per-line hclAvitasShare and sec24PctSnapshot come out
 * EXACTLY as production produces them — including the null-% case (the open month
 * has no approval, so its Sec 24 share/% stay NULL → the dashboard renders "—").
 *
 * Idempotent: deletes its own demo data (by known department names + emails)
 * first, then recreates it. Audit rows are written as SYSTEM (no request context),
 * so they never FK-reference these users — safe to re-run against the append-only
 * audit triggers. Run AFTER seed-admin (it reuses / creates the Finance Admin who
 * owns the Sec 24 %).
 *
 * Runs against the COMPILED dist (kept fresh by `nest start --watch`, or built by
 * the prisma:seed:corp script) so NestJS decorator metadata is present for DI.
 *
 * Dev passwords (DEV ONLY):
 *   corp.spoc@cpp.local    / Spoc@12345    (DEPT_SPOC → IT, HR, Shared Services)
 *   corp.finance@cpp.local / FinMgr@12345  (CORP_FINANCE_MANAGER → all departments)
 *   corp.viewer@cpp.local  / Clinic@12345  (DEPT_VIEWER → IT)
 */
import { createRequire } from 'node:module';
import { NestFactory } from '@nestjs/core';
import { CorpDepartmentType, UserRole } from '@prisma/client';

// Resolve compiled app + providers from dist (relative to dist/prisma/<this file>).
// Required at runtime so the classes carry the DI metadata emitted by nest build.
const dist = createRequire(__filename);
/* eslint-disable @typescript-eslint/no-var-requires */
const { AppModule } = dist('../app.module');
const { PrismaService } = dist('../prisma/prisma.service');
const { CorpDepartmentsService } = dist('../corp-departments/corp-departments.service');
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
const PRIOR = shiftMonth(CUR, -1);
const SEC24_NOTE = '[demo] Sec 24 shared-cost allocation';

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

interface DeptDef {
  key: string;
  name: string;
  type: CorpDepartmentType;
  heads: string[];
  codes: { code: string; description: string }[];
  /** Prior-month per-head provision amounts (aligned to `heads`). */
  prior: number[];
}

const DEPARTMENTS: DeptDef[] = [
  {
    key: 'IT',
    name: 'Information Technology',
    type: CorpDepartmentType.STANDARD,
    heads: ['Cloud Infrastructure', 'Software Licenses', 'Hardware & Devices'],
    codes: [
      { code: 'IT-OPX', description: 'IT operating expenditure' },
      { code: 'IT-CAP', description: 'IT capital expenditure' },
    ],
    prior: [820000, 460000, 310000],
  },
  {
    key: 'HR',
    name: 'Human Resources',
    type: CorpDepartmentType.STANDARD,
    heads: ['Recruitment', 'Training & Development', 'Employee Welfare'],
    codes: [
      { code: 'HR-OPX', description: 'HR operating expenditure' },
      { code: 'HR-LND', description: 'Learning & development' },
    ],
    prior: [240000, 180000, 150000],
  },
  {
    key: 'SS',
    name: 'Shared Services (Sec 24)',
    type: CorpDepartmentType.SHARED_COST_POOL,
    heads: ['Facilities', 'Utilities', 'Security Services'],
    codes: [
      { code: 'SS-SHARED', description: 'Shared cost pool' },
      { code: 'SS-FAC', description: 'Facilities management' },
    ],
    prior: [560000, 320000, 210000],
  },
];

const CORP_EMAILS = ['corp.spoc@cpp.local', 'corp.finance@cpp.local', 'corp.viewer@cpp.local'];

/* eslint-disable @typescript-eslint/no-explicit-any */
async function cleanup(prisma: any): Promise<void> {
  const depts = await prisma.corpDepartment.findMany({
    where: { name: { in: DEPARTMENTS.map((d) => d.name) } },
    select: { id: true },
  });
  const deptIds = depts.map((d: any) => d.id);

  if (deptIds.length) {
    const subs = await prisma.corpMonthlySubmission.findMany({
      where: { departmentId: { in: deptIds } },
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
    await prisma.corpBudgetCode.deleteMany({ where: { departmentId: { in: deptIds } } });
    await prisma.corpExpenseHead.deleteMany({ where: { departmentId: { in: deptIds } } });
    await prisma.userDepartmentAssignment.deleteMany({ where: { departmentId: { in: deptIds } } });
  }
  await prisma.sec24AllocationConfig.deleteMany({ where: { notes: SEC24_NOTE } });
  await prisma.user.deleteMany({ where: { email: { in: CORP_EMAILS } } });
  if (deptIds.length) {
    await prisma.corpDepartment.deleteMany({ where: { id: { in: deptIds } } });
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const departmentsSvc = app.get(CorpDepartmentsService);
    const headsSvc = app.get(CorpExpenseHeadsService);
    const codesSvc = app.get(CorpBudgetCodesService);
    const sec24Svc = app.get(Sec24AllocationService);
    const cycleSvc = app.get(CorpCycleService);
    const entrySvc = app.get(CorpProvisionEntryService);
    const workflowSvc = app.get(CorpWorkflowService);
    const usersSvc = app.get(UsersService);

    await cleanup(prisma);

    // ── Masters via services (audited). ──────────────────────────────────────
    const deptId: Record<string, string> = {};
    const firstCodeId: Record<string, string> = {};
    for (const d of DEPARTMENTS) {
      const dept = await departmentsSvc.create({ name: d.name, type: d.type });
      deptId[d.key] = dept.id;
      for (const name of d.heads) {
        await headsSvc.create(dept.id, { name });
      }
      let first = '';
      for (const c of d.codes) {
        const bc = await codesSvc.create(dept.id, { code: c.code, description: c.description });
        if (!first) first = bc.id;
      }
      firstCodeId[d.key] = first;
    }

    // ── Users via UsersService (multi-dept SPOC; manager holds none). ─────────
    const spocAdmin = await usersSvc.create({
      name: 'Corporate SPOC',
      email: 'corp.spoc@cpp.local',
      password: 'Spoc@12345',
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptId.IT, deptId.HR, deptId.SS],
    });
    const finAdmin = await usersSvc.create({
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

    const spoc = asUser(spocAdmin.id, 'corp.spoc@cpp.local', UserRole.DEPT_SPOC);
    const fin = asUser(finAdmin.id, 'corp.finance@cpp.local', UserRole.CORP_FINANCE_MANAGER);

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

    // ── Sec 24 allocation %: append-only, effective well before PRIOR so the
    //    PRIOR approval freezes 60% into the pool's submission. ───────────────
    await sec24Svc.setAllocation(admin, {
      allocationPct: 60,
      effectiveFromMonth: shiftMonth(CUR, -6),
      notes: SEC24_NOTE,
    });

    // ── Per-cycle notification config (variance threshold) if absent. ────────
    for (const month of [PRIOR, CUR]) {
      const existing = await prisma.notificationConfig.findUnique({ where: { month } });
      if (!existing) {
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
    }

    // ── Open the CURRENT cycle for every department (NOT_STARTED + frozen
    //    heads) — ready for the SPOC to enter & submit in the browser. ────────
    for (const d of DEPARTMENTS) {
      await cycleSvc.openDepartmentCycle(deptId[d.key], CUR);
    }

    // ── Drive a fully-approved PRIOR month through the real workflow so the
    //    dashboard has month-on-month + variance data and (for the pool) a
    //    FROZEN Sec 24 share computed by the approve transaction itself. ──────
    for (const d of DEPARTMENTS) {
      const { submission } = await cycleSvc.openDepartmentCycle(deptId[d.key], PRIOR);
      const items = submission.snapshots.map((snap: any) => {
        const idx = d.heads.indexOf(snap.expenseHeadNameAtSnapshot);
        return { snapshotId: snap.id, budgetCodeId: firstCodeId[d.key], amount: d.prior[idx] };
      });
      await entrySvc.saveEntries(submission.id, spoc, items);
      await workflowSvc.submit(submission.id, spoc, 'Demo: prior-month provision.');
      await workflowSvc.openReview(submission.id, fin);
      await workflowSvc.approve(submission.id, fin, 'Demo: approved.');
    }

    console.log('✔ Corporate demo data ready (driven through the real services)');
    console.log(`  months:        ${PRIOR} (approved via workflow) · ${CUR} (open, NOT_STARTED)`);
    console.log(`  departments:   ${DEPARTMENTS.map((d) => d.name).join(', ')}`);
    console.log('  logins (dev):');
    console.log('    DEPT_SPOC             corp.spoc@cpp.local     /  Spoc@12345');
    console.log('    CORP_FINANCE_MANAGER  corp.finance@cpp.local  /  FinMgr@12345');
    console.log('    DEPT_VIEWER           corp.viewer@cpp.local   /  Clinic@12345');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

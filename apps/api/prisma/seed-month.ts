/**
 * ADDITIVE single-month seed — fills ONE cost-provision month with realistic data,
 * driven through the real services.
 *
 * Run from apps/api:
 *   pnpm prisma:seed:month                 # the current IST month (e.g. 2026-08)
 *   pnpm prisma:seed:month -- --month=2026-08
 *
 * WHY THIS EXISTS SEPARATELY FROM seed-demo.ts
 * `seed-demo.ts` builds the whole demo world and is DESTRUCTIVE: it deletes the
 * demo clinics and resets the ExpenseHead master wholesale. Once a month rolls over
 * you don't want that — the history, the users, the masters and any clinic someone
 * added by hand are all worth keeping; you only want the NEW month populated. This
 * script touches exactly one month and nothing else.
 *
 * WHAT IT TOUCHES
 *   • the target month's MonthlySubmission rows for eligible clinics — deleted and
 *     rebuilt (that is what makes a re-run idempotent). Every child row cascades:
 *     snapshots, entries, particulars, comments (notifications keep their history
 *     with a null submission).
 * WHAT IT NEVER TOUCHES
 *   • any other month, every user, every clinic, and the whole expense-head master.
 *
 * EVERYTHING GOES THROUGH THE REAL SERVICES — CycleService.openClinicCycle →
 * ProvisionEntryService.saveEntries → WorkflowService.submit / managerOpenReview /
 * managerApprove / managerSendBack / financeOpenReview / financeApprove. No status
 * is ever written by hand, so the head snapshots, the DERIVED line amounts, the
 * approval stamps and the audit trail are all produced by the same code the browser
 * drives. A state the workflow would refuse simply cannot be seeded.
 *
 * REAL VALUES ONLY — no invented masters. Each clinic's figures are copied from its
 * own most recent populated month (real G/L heads, real vendors, real product
 * codes, real particular names) and then drifted, so the new month reads as a
 * continuation of that clinic's actual history rather than synthetic filler. A head
 * that clinic has never provisioned borrows the most recent line for the SAME head
 * at another clinic. NULL ≠ 0 is respected throughout: a clinic with no usable
 * template is LEFT ALONE at "No entry yet", never zero-filled.
 *
 * Boots the Nest application context, so the app must be compiled first;
 * `pnpm prisma:seed:month` runs `nest build` for you.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaClient, SubmissionStatus, UserRole } from '@prisma/client';
import { HEAD_BASELINES, clinicFactor } from './head-baselines';

// Resolve the compiled app + providers from dist (relative to dist/prisma/<this
// file>), so the classes carry the DI metadata emitted by `nest build`.
const dist = createRequire(__filename);
const { AppModule } = dist('../app.module');
const { PrismaService } = dist('../prisma/prisma.service');
const { CycleService } = dist('../submissions/cycle.service');
const { ProvisionEntryService } = dist('../submissions/provision-entry.service');
const { WorkflowService } = dist('../submissions/workflow.service');

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

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current cost-provision month (YYYY-MM) in IST. */
function currentMonthIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Target month: `--month=YYYY-MM`, else SEED_MONTH, else the current IST month. */
function targetMonth(): string {
  const arg = process.argv.find((a) => a.startsWith('--month='))?.slice('--month='.length);
  const month = arg ?? process.env.SEED_MONTH ?? currentMonthIST();
  if (!MONTH_RE.test(month)) {
    throw new Error(`--month must be YYYY-MM (got "${month}")`);
  }
  return month;
}

/** The `RequestUser` shape the services expect for an actor. */
interface SeedUser {
  id: string;
  email: string;
  role: UserRole;
  clinicIds: string[];
  tokenVersion: number;
}
const asUser = (
  id: string,
  email: string,
  role: UserRole,
  clinicIds: string[] = [],
): SeedUser => ({ id, email, role, clinicIds, tokenVersion: 0 });

/**
 * The status each eligible clinic lands on, applied in clinic-name order and
 * cycled if there are more clinics than entries.
 *
 * The first two are load-bearing for the demo: the FINANCE MANAGER's board buckets
 * ONLY `FINANCE_APPROVED` into "approved" and ONLY `FINANCE_REVIEW` into "in
 * review" — everything else falls into "not provided". Leading with one of each is
 * what stops two of the three columns rendering empty. The rest are the upstream
 * states that give the SPOC and cluster-manager queues something to work on, and
 * the trailing DRAFT leaves one clinic a SPOC can walk end-to-end in the browser.
 */
const STATUS_PLAN: SubmissionStatus[] = [
  SubmissionStatus.FINANCE_APPROVED, // done, locked        → "approved"
  SubmissionStatus.FINANCE_REVIEW, // on the finance desk → "in review"
  SubmissionStatus.CLINIC_APPROVED, // cleared by cluster mgr, awaiting finance
  SubmissionStatus.CLINIC_MANAGER_REVIEW, // in the cluster manager's queue
  SubmissionStatus.SUBMITTED, // sent by the SPOC, not yet opened
  SubmissionStatus.SENT_BACK_BY_MANAGER, // bounced by the cluster manager
  SubmissionStatus.SENT_BACK_BY_FINANCE, // bounced by finance
  SubmissionStatus.DRAFT, // SPOC part-way through
  SubmissionStatus.NOT_STARTED, // untouched — "No entry yet", never ₹0
];

/** Every history month lands fully approved, so trends and variance have a base. */
const HISTORY_STATUS = SubmissionStatus.FINANCE_APPROVED;

/** One particular copied from a template line, ready to re-save. */
interface TemplateParticular {
  particularName: string;
  rate: number;
  quantity: number;
  remark: string | null;
}
/** One vendor line copied from a template month. */
interface TemplateLine {
  expenseHeadId: string;
  vendorName: string;
  productCode: string;
  particulars: TemplateParticular[];
}

let prisma: PrismaClient;

/**
 * Every usable vendor line of a clinic's most recent populated month before
 * `month`. "Usable" means the workflow would have accepted it: a vendor name, a
 * product code, and at least one particular with a name, rate and quantity.
 */
async function templateFor(clinicId: string, month: string): Promise<TemplateLine[]> {
  const source = await prisma.monthlySubmission.findFirst({
    where: {
      clinicId,
      month: { lt: month },
      entries: { some: { particulars: { some: { value: { not: null } } } } },
    },
    orderBy: { month: 'desc' },
    include: {
      entries: {
        orderBy: { lineOrder: 'asc' },
        include: {
          snapshot: { select: { expenseHeadId: true } },
          particulars: { orderBy: { lineOrder: 'asc' } },
        },
      },
    },
  });
  if (!source) return [];

  return source.entries
    .filter(
      (e) =>
        e.vendorName &&
        e.productCode &&
        e.particulars.some((p) => p.particularName && p.rate !== null && p.quantity !== null),
    )
    .map((e) => ({
      expenseHeadId: e.snapshot.expenseHeadId,
      vendorName: e.vendorName as string,
      productCode: e.productCode as string,
      particulars: e.particulars
        .filter((p) => p.particularName && p.rate !== null && p.quantity !== null)
        .map((p) => ({
          particularName: p.particularName as string,
          rate: Number(p.rate),
          quantity: Number(p.quantity),
          remark: p.remark,
        })),
    }));
}

async function main(): Promise<void> {
  const month = targetMonth();
  // `--all-approved` drives EVERY clinic to FINANCE_APPROVED instead of spreading
  // them across the status plan. That is what a HISTORY month wants: the trend,
  // clinic-total and variance charts need complete, settled figures behind them,
  // and a half-approved past month would read as work still outstanding.
  const plan = process.argv.includes('--all-approved') ? [HISTORY_STATUS] : STATUS_PLAN;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    prisma = app.get(PrismaService);
    const cycleSvc = app.get(CycleService);
    const entrySvc = app.get(ProvisionEntryService);
    const workflowSvc = app.get(WorkflowService);

    // A finance approver to drive the finance half of the ladder.
    const financeRow = await prisma.user.findFirst({
      where: { role: { in: [UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER] }, isActive: true },
      orderBy: { role: 'asc' },
    });
    if (!financeRow) throw new Error('No active finance approver found — run the admin seed first.');
    const finance = asUser(financeRow.id, financeRow.email, financeRow.role);

    // Only ACTIVE clinics take part; an inactive clinic has no current cycle.
    const clinics = await prisma.clinic.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    const done: Array<{ clinic: string; status: SubmissionStatus; lines: number }> = [];
    const skipped: Array<{ clinic: string; why: string }> = [];
    let planIndex = 0;

    for (const clinic of clinics) {
      // Actors must be the clinic's OWN staff — the services check scope, so a
      // clinic without an active SPOC or manager genuinely cannot be driven.
      const [spocRow, managerRow] = await Promise.all([
        prisma.user.findFirst({
          where: {
            role: UserRole.CLINIC_SPOC,
            isActive: true,
            assignments: { some: { clinicId: clinic.id } },
          },
        }),
        prisma.user.findFirst({
          where: {
            role: UserRole.CLINIC_MANAGER,
            isActive: true,
            assignments: { some: { clinicId: clinic.id } },
          },
        }),
      ]);
      if (!spocRow || !managerRow) {
        skipped.push({ clinic: clinic.name, why: 'no active SPOC and/or clinic manager assigned' });
        continue;
      }

      // Prior month if this clinic has one; otherwise the per-head baselines carry
      // it (see baselineLinesForHead), so a freshly imported clinic with no history
      // anywhere can still be provisioned on its very first run.
      const template = await templateFor(clinic.id, month);

      const status = plan[planIndex % plan.length];
      planIndex += 1;

      // NOT_STARTED is "cycle opened, nothing entered" — the honest empty state.
      // Open the cycle so the month exists, then leave it strictly alone: no
      // entries, no transitions. NULL ≠ 0, so it reads "No entry yet", never ₹0.
      if (status === SubmissionStatus.NOT_STARTED) {
        await prisma.monthlySubmission.deleteMany({ where: { clinicId: clinic.id, month } });
        await cycleSvc.openClinicCycle(clinic.id, month);
        done.push({ clinic: clinic.name, status, lines: 0 });
        continue;
      }

      const spoc = asUser(spocRow.id, spocRow.email, UserRole.CLINIC_SPOC, [clinic.id]);
      const manager = asUser(managerRow.id, managerRow.email, UserRole.CLINIC_MANAGER, [clinic.id]);

      // Idempotency: drop this month's submission (children cascade) and reopen the
      // cycle, so a re-run rebuilds rather than colliding on @@unique(clinicId, month).
      await prisma.monthlySubmission.deleteMany({ where: { clinicId: clinic.id, month } });
      const { submission } = await cycleSvc.openClinicCycle(clinic.id, month);

      // Map the template onto THIS month's frozen heads. A head the clinic has
      // never provisioned borrows the most recent line for the same head elsewhere,
      // so a newly-mapped head doesn't block the submit.
      const byHead = new Map<string, TemplateLine[]>();
      for (const line of template) {
        byHead.set(line.expenseHeadId, [...(byHead.get(line.expenseHeadId) ?? []), line]);
      }

      // Drift: a small per-clinic month-on-month rise, plus ONE deliberate spike on
      // the first clinic so the variance chart has something to flag.
      const drift = 1 + ((planIndex * 7) % 5) / 100; // +1%..+5%, deterministic
      // Spike Radiology Services at the first clinic. Keyed by G/L NUMBER rather
      // than a template row, so it still fires for a clinic with no history.
      const spikeGlNo = planIndex === 1 ? '41104016' : undefined;

      const snapshots = submission.snapshots as Array<{
        id: string;
        expenseHeadId: string;
        expenseHeadGlNoAtSnapshot: string;
        expenseHeadGlNameAtSnapshot: string;
        expenseHeadAllowsMultipleVendorsAtSnapshot: boolean;
      }>;
      let unmapped = 0;
      const items = [];
      for (const snap of snapshots) {
        // Preference order, most faithful first: this clinic's own prior month →
        // the same head at another clinic → the static baseline table. Only the
        // last invents a figure, and only for a clinic with no history anywhere.
        let lines = byHead.get(snap.expenseHeadId);
        if (!lines) {
          const borrowed = await borrowLineForHead(snap.expenseHeadId, month);
          lines = borrowed ? [borrowed] : undefined;
        }
        if (!lines) {
          const baseline = baselineLinesForHead(
            snap.expenseHeadGlNoAtSnapshot,
            snap.expenseHeadGlNameAtSnapshot,
            snap.expenseHeadAllowsMultipleVendorsAtSnapshot,
            clinic.id,
          );
          lines = baseline.length > 0 ? baseline : undefined;
        }
        if (!lines) {
          unmapped += 1;
          continue;
        }
        const factor =
          spikeGlNo && snap.expenseHeadGlNoAtSnapshot === spikeGlNo ? drift * 2.4 : drift;
        items.push({
          snapshotId: snap.id,
          lines: lines.map((line) => ({
            vendorName: line.vendorName,
            productCode: line.productCode,
            particulars: line.particulars.map((p) => ({
              particularName: p.particularName,
              // Only the RATE drifts; quantity stays whole and meaningful. The
              // value itself is derived server-side from rate × quantity.
              rate: Number((p.rate * factor).toFixed(2)),
              quantity: p.quantity,
              ...(p.remark ? { remark: p.remark } : {}),
            })),
          })),
        });
      }

      await entrySvc.saveEntries(submission.id, spoc, items);
      const lineCount = items.reduce((n, i) => n + i.lines.length, 0);

      // A head left unvalued would make submit fail BR-03, so such a clinic stops
      // at DRAFT — honestly incomplete rather than fabricated.
      const target = unmapped > 0 ? SubmissionStatus.DRAFT : status;
      if (unmapped > 0) {
        skipped.push({
          clinic: clinic.name,
          why: `${unmapped} head(s) had no line to model on — left as DRAFT`,
        });
      }

      await driveTo(workflowSvc, submission.id, target, { spoc, manager, finance });
      done.push({ clinic: clinic.name, status: target, lines: lineCount });
    }

    report(month, done, skipped);
  } finally {
    await app.close();
  }
}

/**
 * Bootstrap lines for a head from the static baseline table, for a clinic with no
 * history anywhere to copy. Split into two particulars (a rate × quantity pair plus
 * a balancing one-off) so the sheet shows the same structure a SPOC would type, and
 * scaled per clinic so no two clinics report identical figures.
 *
 * Returns [] when the head has no baseline — the caller then leaves that head
 * unvalued and the clinic stops at DRAFT rather than being pushed through a submit
 * that BR-03 would reject.
 */
function baselineLinesForHead(
  glAccountNo: string,
  glAccountName: string,
  allowsMultipleVendors: boolean,
  clinicId: string,
): TemplateLine[] {
  const baseline = HEAD_BASELINES[glAccountNo];
  if (!baseline) return [];

  const amount = Math.round(baseline.base * clinicFactor(clinicId));
  const split = (target: number, remark: string | null) => {
    // ~60% across 12 whole units at a 2-dp rate; the rest as a single balancing
    // unit, so the two particulars sum to the target EXACTLY.
    const paise = Math.round(target * 100);
    const units = 12;
    const firstRate = Math.floor((paise * 0.6) / units);
    const rest = paise - firstRate * units;
    return [
      {
        particularName: `${glAccountName} — monthly units`,
        rate: Number((firstRate / 100).toFixed(2)),
        quantity: units,
        remark,
      },
      {
        particularName: `${glAccountName} — balance / one-off`,
        rate: Number((rest / 100).toFixed(2)),
        quantity: 1,
        remark: null,
      },
    ];
  };

  const lines: TemplateLine[] = [
    {
      expenseHeadId: '',
      vendorName: baseline.vendor,
      productCode: baseline.product,
      particulars: split(amount, baseline.description ?? null),
    },
  ];
  if (allowsMultipleVendors && baseline.vendor2) {
    lines.push({
      expenseHeadId: '',
      vendorName: baseline.vendor2,
      productCode: baseline.product,
      particulars: split(Math.round(amount * 0.4), null),
    });
  }
  return lines;
}

/** The most recent usable line for one head at ANY clinic, for a head this clinic lacks. */
async function borrowLineForHead(expenseHeadId: string, month: string): Promise<TemplateLine | null> {
  const entry = await prisma.provisionEntry.findFirst({
    where: {
      snapshot: { expenseHeadId },
      submission: { month: { lt: month } },
      vendorName: { not: null },
      productCode: { not: null },
      particulars: { some: { value: { not: null } } },
    },
    orderBy: { submission: { month: 'desc' } },
    include: { particulars: { orderBy: { lineOrder: 'asc' } } },
  });
  if (!entry) return null;
  const particulars = entry.particulars
    .filter((p) => p.particularName && p.rate !== null && p.quantity !== null)
    .map((p) => ({
      particularName: p.particularName as string,
      rate: Number(p.rate),
      quantity: Number(p.quantity),
      remark: p.remark,
    }));
  if (particulars.length === 0) return null;
  return {
    expenseHeadId,
    vendorName: entry.vendorName as string,
    productCode: entry.productCode as string,
    particulars,
  };
}

/**
 * Walk the real approval ladder to `target`. Each step is the genuine transition,
 * so an unreachable target throws here rather than quietly producing a row whose
 * status and stamps disagree.
 */
async function driveTo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflowSvc: any,
  submissionId: string,
  target: SubmissionStatus,
  actors: { spoc: SeedUser; manager: SeedUser; finance: SeedUser },
): Promise<void> {
  const { spoc, manager, finance } = actors;
  // saveEntries already left it in DRAFT via the SPOC's own save-draft transition.
  if (target === SubmissionStatus.DRAFT) return;

  await workflowSvc.submit(submissionId, spoc, 'Monthly cost provision submitted for review.');
  if (target === SubmissionStatus.SUBMITTED) return;

  await workflowSvc.managerOpenReview(submissionId, manager);
  if (target === SubmissionStatus.CLINIC_MANAGER_REVIEW) return;

  if (target === SubmissionStatus.SENT_BACK_BY_MANAGER) {
    await workflowSvc.managerSendBack(
      submissionId,
      manager,
      'A few heads look high against last month — please re-check the vendor invoices and resubmit.',
    );
    return;
  }

  await workflowSvc.managerApprove(submissionId, manager, 'Reviewed at the clinic — sending to finance.');
  if (target === SubmissionStatus.CLINIC_APPROVED) return;

  await workflowSvc.financeOpenReview(submissionId, finance);
  if (target === SubmissionStatus.FINANCE_REVIEW) return;

  if (target === SubmissionStatus.SENT_BACK_BY_FINANCE) {
    await workflowSvc.financeSendBack(
      submissionId,
      finance,
      'Please attach the supporting invoice before we can lock this month.',
    );
    return;
  }

  // FINANCE_APPROVED == locked (the approve transaction stamps both).
  await workflowSvc.financeApprove(submissionId, finance, 'Approved and locked for the month.');
}

function report(
  month: string,
  done: Array<{ clinic: string; status: SubmissionStatus; lines: number }>,
  skipped: Array<{ clinic: string; why: string }>,
): void {
  console.log(`✔ Seeded ${month} through the real workflow (cycle open → entry → submit → manager → finance)`);
  for (const d of done) {
    console.log(`    ${d.clinic.padEnd(34)} ${d.status.padEnd(22)} ${d.lines} vendor line(s)`);
  }
  if (skipped.length) {
    console.log('  Left alone (never zero-filled — NULL ≠ 0):');
    for (const s of skipped) console.log(`    ${s.clinic.padEnd(34)} ${s.why}`);
  }
  const approved = done.filter((d) => d.status === SubmissionStatus.FINANCE_APPROVED).length;
  const inReview = done.filter((d) => d.status === SubmissionStatus.FINANCE_REVIEW).length;
  const upstream = done.length - approved - inReview;
  console.log(
    `  Finance board: approved = ${approved} · in review = ${inReview} · not provided = ${upstream}` +
      `${skipped.length ? ` (+${skipped.length} untouched)` : ''}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

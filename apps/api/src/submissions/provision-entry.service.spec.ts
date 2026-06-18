import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionsService } from './submissions.service';
import { ProvisionEntryService } from './provision-entry.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

describe('ProvisionEntryService (Step 6.1 — SPOC data entry)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let submissions: SubmissionsService;
  let entries: ProvisionEntryService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        SubmissionsService,
        ProvisionEntryService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    submissions = moduleRef.get(SubmissionsService);
    entries = moduleRef.get(ProvisionEntryService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** Clinic + opened cycle with `n` mapped heads, plus a scoped SPOC. */
  async function setup(n: number) {
    const clinic = await fx.makeClinic();
    const heads = [];
    for (let i = 0; i < n; i += 1) heads.push(await fx.makeExpenseHead());
    await fx.mapHeads(clinic.id, heads.map((h) => h.id));
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const detail = await submissions.getDetail(submission.id, spoc);
    return { clinic, submission, spoc, snapshotIds: detail.heads.map((h) => h.snapshotId) };
  }

  it('partial-saves and resumes: moves to DRAFT, persists entered values, leaves the rest blank', async () => {
    const { submission, spoc, snapshotIds } = await setup(3);

    const detail = await entries.saveEntries(submission.id, spoc, [
      { snapshotId: snapshotIds[0], amount: 100 },
      { snapshotId: snapshotIds[1], amount: 250.5 },
    ]);

    expect(detail.status).toBe(SubmissionStatus.DRAFT);
    expect(detail.canEdit).toBe(true);
    const amounts = detail.heads.map((h) => h.amount);
    expect(amounts).toEqual(expect.arrayContaining(['100.00', '250.50', null]));
    expect(amounts.filter((a) => a === null)).toHaveLength(1);

    // Resume — a fresh read shows the same saved state.
    const resumed = await submissions.getDetail(submission.id, spoc);
    expect(resumed.heads.find((h) => h.snapshotId === snapshotIds[0])!.amount).toBe('100.00');
  });

  it('tracks enteredBy on first write and lastModifiedBy on every write', async () => {
    const { clinic, submission, spoc, snapshotIds } = await setup(1);
    const spoc2 = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;

    await entries.saveEntries(submission.id, spoc, [{ snapshotId: snapshotIds[0], amount: 10 }]);
    let row = await prisma.provisionEntry.findUniqueOrThrow({ where: { snapshotId: snapshotIds[0] } });
    expect(row.enteredById).toBe(spoc.id);
    expect(row.lastModifiedById).toBe(spoc.id);

    await entries.saveEntries(submission.id, spoc2, [{ snapshotId: snapshotIds[0], amount: 20 }]);
    row = await prisma.provisionEntry.findUniqueOrThrow({ where: { snapshotId: snapshotIds[0] } });
    expect(row.enteredById).toBe(spoc.id); // unchanged
    expect(row.lastModifiedById).toBe(spoc2.id); // updated
    expect(row.amount.toFixed(2)).toBe('20.00');
  });

  it('BR-03/BR-07: submit blocked while a head is blank, allowed once all (incl 0) are filled', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    // Only one head valued → submit blocked.
    await entries.saveEntries(submission.id, spoc, [{ snapshotId: snapshotIds[0], amount: 0 }]);
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Fill the rest (explicit 0 is valid) → submit succeeds.
    await entries.saveEntries(submission.id, spoc, [{ snapshotId: snapshotIds[1], amount: 0 }]);
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  it('rejects editing once past SPOC-actionable states (409)', async () => {
    const { submission, spoc } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    await expectStatus(
      entries.saveEntries(submission.id, spoc, []),
      409,
    );
  });

  it('rejects unknown snapshot (400), out-of-scope SPOC (403) and missing submission (404)', async () => {
    const { submission, spoc, clinic } = await setup(1);

    await expectStatus(
      entries.saveEntries(submission.id, spoc, [{ snapshotId: 'not-a-snapshot', amount: 5 }]),
      400,
    );

    const otherClinic = await fx.makeClinic();
    const outsider = (await fx.makeUser(UserRole.CLINIC_SPOC, [otherClinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, outsider, []), 403);
    expect(clinic.id).toBeDefined();

    await expectStatus(entries.saveEntries('no-such-submission', spoc, []), 404);
  });

  // ── Step 8.2 — lock enforcement + Finance Admin override (BR-08) ─────────────

  it('locks an approved submission: SPOC/Manager edits → 403', async () => {
    const { clinic, submission, spoc } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);

    await expectStatus(entries.saveEntries(submission.id, spoc, []), 403);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, manager, []), 403);
  });

  it('Finance Admin override edits a locked submission, keeps it locked, and audit-logs it', async () => {
    const { submission, snapshotIds } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    const detail = await runWithRequestContext({ user: { id: admin.id }, ip: '203.0.113.7' }, () =>
      entries.saveEntries(submission.id, admin, [{ snapshotId: snapshotIds[0], amount: 4242 }]),
    );

    // Edit applied; status stays FINANCE_APPROVED (still locked).
    expect(detail.status).toBe(SubmissionStatus.FINANCE_APPROVED);
    expect(detail.locked).toBe(true);
    expect(detail.heads[0].amount).toBe('4242.00');

    // One audit row recorded for the override (other rows exist from the drive).
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'PROVISION_EDIT_OVERRIDE' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(admin.id);
    expect(audits[0].ipAddress).toBe('203.0.113.7');
  });

  // ── Iteration 2 — Clinic Manager value override (own clinic, review stage) ────

  it('Manager override edits the canonical entry during review, keeps the status, preserves enteredBy, and audits it', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    // Original entry was written by the SPOC during the drive.
    const original = await prisma.provisionEntry.findUniqueOrThrow({
      where: { snapshotId: snapshotIds[0] },
    });
    expect(original.lastModifiedById).not.toBe(manager.id);

    const detail = await runWithRequestContext(
      { user: { id: manager.id }, ip: '198.51.100.9' },
      () => entries.saveEntries(submission.id, manager, [{ snapshotId: snapshotIds[0], amount: 9999 }]),
    );

    // Value overwritten; status unchanged (override never advances the workflow).
    expect(detail.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    expect(detail.heads[0].amount).toBe('9999.00');

    // Provenance: enteredBy stays the SPOC; lastModifiedBy becomes the manager.
    const row = await prisma.provisionEntry.findUniqueOrThrow({
      where: { snapshotId: snapshotIds[0] },
    });
    expect(row.enteredById).toBe(original.enteredById);
    expect(row.enteredById).not.toBe(manager.id);
    expect(row.lastModifiedById).toBe(manager.id);

    // A fresh read (any user) sees the new canonical value.
    const refetched = await submissions.getDetail(submission.id, manager);
    expect(refetched.heads[0].amount).toBe('9999.00');

    // Audited as MANAGER_PROVISION_OVERRIDE with old→new, actor, and IP.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'MANAGER_PROVISION_OVERRIDE' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(manager.id);
    expect(audits[0].ipAddress).toBe('198.51.100.9');
    expect(audits[0].newValue).toEqual([{ snapshotId: snapshotIds[0], amount: 9999 }]);
  });

  it('Manager override is allowed in the SUBMITTED stage too (before opening review)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);

    const detail = await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, [{ snapshotId: snapshotIds[0], amount: 12 }]),
    );
    expect(detail.status).toBe(SubmissionStatus.SUBMITTED);
    expect(detail.heads[0].amount).toBe('12.00');
  });

  it('Manager override is rejected outside the review stage — e.g. once CLINIC_APPROVED (409)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_APPROVED);

    await expectStatus(
      entries.saveEntries(submission.id, manager, [{ snapshotId: snapshotIds[0], amount: 1 }]),
      409,
    );
  });

  it("Manager cannot override another clinic's submission (403)", async () => {
    const { submission } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    const otherClinic = await fx.makeClinic();
    const outsideManager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [otherClinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, outsideManager, []), 403);
  });
});

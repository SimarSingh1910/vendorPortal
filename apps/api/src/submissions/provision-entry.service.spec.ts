import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmissionStatus, UserRole, type ProvisionEntryInput } from '@portal/shared';
import { ProvisionEntryItemDto, ProvisionLineItemDto } from './dto/save-entries.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { SubmissionsService } from './submissions.service';
import { ProvisionEntryService } from './provision-entry.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import type { RequestUser } from '../auth/request-user';
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

  /** A single-line save payload for one head (create when `entryId` omitted). */
  function one(
    snapshotId: string,
    amount: number | null,
    extras: { note?: string; vendorName?: string; productCode?: string; entryId?: string } = {},
  ): ProvisionEntryInput[] {
    return [
      {
        snapshotId,
        lines: [
          {
            entryId: extras.entryId,
            amount,
            note: extras.note,
            vendorName: extras.vendorName,
            productCode: extras.productCode,
          },
        ],
      },
    ];
  }

  /** The current first-line entry id for a head (used for update/override saves). */
  async function entryIdOf(
    subId: string,
    user: RequestUser,
    snapshotId: string,
    line = 0,
  ): Promise<string | undefined> {
    const d = await submissions.getDetail(subId, user);
    return d.heads.find((h) => h.snapshotId === snapshotId)?.lines[line]?.entryId ?? undefined;
  }

  /** Clinic + opened cycle with `n` mapped heads, plus a scoped SPOC. */
  async function setup(n: number) {
    const clinic = await fx.makeClinic();
    const heads = [];
    for (let i = 0; i < n; i += 1) heads.push(await fx.makeExpenseHead());
    await fx.mapHeads(
      clinic.id,
      heads.map((h) => h.id),
    );
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const detail = await submissions.getDetail(submission.id, spoc);
    return { clinic, submission, spoc, snapshotIds: detail.heads.map((h) => h.snapshotId) };
  }

  /** A clinic with ONE multi-vendor head, opened, plus a scoped SPOC. */
  async function setupMulti() {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead({ allowsMultipleVendors: true });
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const detail = await submissions.getDetail(submission.id, spoc);
    return { clinic, submission, spoc, snapshotId: detail.heads[0].snapshotId };
  }

  it('partial-saves and resumes: moves to DRAFT, persists entered values, leaves the rest blank', async () => {
    const { submission, spoc, snapshotIds } = await setup(3);

    const detail = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 100),
      ...one(snapshotIds[1], 250.5),
    ]);

    expect(detail.status).toBe(SubmissionStatus.DRAFT);
    expect(detail.canEdit).toBe(true);
    const amounts = detail.heads.map((h) => h.lines[0]?.amount ?? null);
    expect(amounts).toEqual(expect.arrayContaining(['100.00', '250.50', null]));
    expect(amounts.filter((a) => a === null)).toHaveLength(1);

    // Resume — a fresh read shows the same saved state.
    const resumed = await submissions.getDetail(submission.id, spoc);
    expect(resumed.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0].amount).toBe('100.00');
  });

  it('every head exposes at least one line; a blank head has a single null-amount line', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);
    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 100));
    const detail = await submissions.getDetail(submission.id, spoc);
    const blank = detail.heads.find((h) => h.snapshotId === snapshotIds[1])!;
    expect(blank.lines).toHaveLength(1);
    expect(blank.lines[0].amount).toBeNull();
    expect(blank.lines[0].entryId).toBeNull();
  });

  it('tracks enteredBy on first write and lastModifiedBy on every write', async () => {
    const { clinic, submission, spoc, snapshotIds } = await setup(1);
    const spoc2 = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;

    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 10));
    let row = await prisma.provisionEntry.findFirstOrThrow({ where: { snapshotId: snapshotIds[0] } });
    expect(row.enteredById).toBe(spoc.id);
    expect(row.lastModifiedById).toBe(spoc.id);

    // Second save carries the existing entry id → updates the SAME row (as the UI does).
    await entries.saveEntries(submission.id, spoc2, one(snapshotIds[0], 20, { entryId: row.id }));
    row = await prisma.provisionEntry.findFirstOrThrow({ where: { snapshotId: snapshotIds[0] } });
    expect(row.enteredById).toBe(spoc.id); // unchanged
    expect(row.lastModifiedById).toBe(spoc2.id); // updated
    expect(row.amount!.toFixed(2)).toBe('20.00');
  });

  it('BR-03/BR-07: submit blocked while a head is blank, allowed once all (incl 0) are filled', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    // Only one head valued → submit blocked.
    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 0));
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Fill the rest (explicit 0 is valid) → submit succeeds.
    await entries.saveEntries(submission.id, spoc, one(snapshotIds[1], 0));
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  it('rejects editing once past SPOC-actionable states (409)', async () => {
    const { submission, spoc } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    await expectStatus(entries.saveEntries(submission.id, spoc, []), 409);
  });

  it('rejects unknown snapshot (400), out-of-scope SPOC (403) and missing submission (404)', async () => {
    const { submission, spoc, clinic } = await setup(1);

    await expectStatus(entries.saveEntries(submission.id, spoc, one('not-a-snapshot', 5)), 400);

    const otherClinic = await fx.makeClinic();
    const outsider = (await fx.makeUser(UserRole.CLINIC_SPOC, [otherClinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, outsider, []), 403);
    expect(clinic.id).toBeDefined();

    await expectStatus(entries.saveEntries('no-such-submission', spoc, []), 404);
  });

  // ── Multiple vendor lines (flagged heads) ────────────────────────────────────

  it('surfaces the multi-vendor flag on the head detail (data-driven, not hardcoded)', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    const single = await setup(1);
    const flagged = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    expect(flagged.allowsMultipleVendors).toBe(true);
    const plain = (await submissions.getDetail(single.submission.id, single.spoc)).heads[0];
    expect(plain.allowsMultipleVendors).toBe(false);
  });

  it('a flagged head accepts multiple lines in one submission (own vendor/amount per line)', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    const detail = await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: [
          { amount: 100, vendorName: 'Vendor A' },
          { amount: 250, vendorName: 'Vendor B' },
        ],
      },
    ]);
    const head = detail.heads.find((h) => h.snapshotId === snapshotId)!;
    expect(head.lines).toHaveLength(2);
    expect(head.lines.map((l) => l.amount)).toEqual(['100.00', '250.00']);
    expect(head.lines.map((l) => l.vendorName)).toEqual(['Vendor A', 'Vendor B']);
    expect(head.lines.map((l) => l.lineOrder)).toEqual([0, 1]);
  });

  it('a non-flagged head rejects more than one line (400)', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);
    await expectStatus(
      entries.saveEntries(submission.id, spoc, [
        { snapshotId: snapshotIds[0], lines: [{ amount: 10 }, { amount: 20 }] },
      ]),
      400,
    );
    // Still exactly zero rows created.
    expect(await prisma.provisionEntry.count({ where: { submissionId: submission.id } })).toBe(0);
  });

  it('saving a head does not overwrite or delete its other (sibling) lines', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    // Two lines saved.
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: [
          { amount: 100, vendorName: 'Vendor A' },
          { amount: 250, vendorName: 'Vendor B' },
        ],
      },
    ]);
    const before = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    const [l0, l1] = before.lines;

    // Re-save the FULL set with only line 0's amount changed.
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: [
          { entryId: l0.entryId!, amount: 999, vendorName: 'Vendor A' },
          { entryId: l1.entryId!, amount: 250, vendorName: 'Vendor B' },
        ],
      },
    ]);

    const after = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    expect(after.lines).toHaveLength(2);
    expect(after.lines.find((l) => l.entryId === l0.entryId)!.amount).toBe('999.00');
    // Sibling untouched.
    const sibling = after.lines.find((l) => l.entryId === l1.entryId)!;
    expect(sibling.amount).toBe('250.00');
    expect(sibling.vendorName).toBe('Vendor B');
  });

  it('removing a line persists (it drops out of the payload)', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    await entries.saveEntries(submission.id, spoc, [
      { snapshotId, lines: [{ amount: 100 }, { amount: 250 }] },
    ]);
    const both = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    const keep = both.lines[0];

    // Save with only the kept line → the sibling is removed.
    await entries.saveEntries(submission.id, spoc, [
      { snapshotId, lines: [{ entryId: keep.entryId!, amount: 100 }] },
    ]);
    const after = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].entryId).toBe(keep.entryId);
    expect(await prisma.provisionEntry.count({ where: { snapshotId } })).toBe(1);
  });

  it('removing the last line of a head is rejected at the DTO (>=1 line required)', async () => {
    const empty = await validate(
      plainToInstance(ProvisionEntryItemDto, { snapshotId: 's', lines: [] }),
    );
    expect(empty.some((e) => e.property === 'lines')).toBe(true);
  });

  it('submit is blocked while a multi-vendor head has a blank line, and passes once every line has an amount', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    // One filled line + one blank (null-amount) line persisted.
    await entries.saveEntries(submission.id, spoc, [
      { snapshotId, lines: [{ amount: 100 }, { amount: null, vendorName: 'incomplete' }] },
    ]);
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Fill the blank line (carry both ids) → submit succeeds.
    const head = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: head.lines.map((l) => ({ entryId: l.entryId!, amount: Number(l.amount ?? 50) })),
      },
    ]);
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  // ── Step 8.2 — lock enforcement + Finance Admin override (BR-08) ─────────────

  it('locks an approved submission: SPOC/Manager edits → 403', async () => {
    const { clinic, submission, spoc } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);

    await expectStatus(entries.saveEntries(submission.id, spoc, []), 403);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, manager, []), 403);
  });

  it('Finance Admin override edits a locked submission per line, keeps it locked, and audit-logs it', async () => {
    const { submission, snapshotIds } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    const id = await entryIdOf(submission.id, admin, snapshotIds[0]);

    const detail = await runWithRequestContext({ user: { id: admin.id }, ip: '203.0.113.7' }, () =>
      entries.saveEntries(submission.id, admin, one(snapshotIds[0], 4242, { entryId: id })),
    );

    // Edit applied; status stays FINANCE_APPROVED (still locked).
    expect(detail.status).toBe(SubmissionStatus.FINANCE_APPROVED);
    expect(detail.locked).toBe(true);
    expect(detail.heads[0].lines[0].amount).toBe('4242.00');

    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'PROVISION_EDIT_OVERRIDE' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(admin.id);
    expect(audits[0].ipAddress).toBe('203.0.113.7');
  });

  it('an override must target an existing line (no entry id → 400)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);
    await expectStatus(
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 9999)),
      400,
    );
  });

  // ── Iteration 2 — Clinic Manager value override (own clinic, review stage) ────

  it('Manager override edits the canonical entry during review, keeps the status, preserves enteredBy, and audits it', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    // Original entry was written by the SPOC during the drive.
    const original = await prisma.provisionEntry.findFirstOrThrow({
      where: { snapshotId: snapshotIds[0] },
    });
    expect(original.lastModifiedById).not.toBe(manager.id);

    const detail = await runWithRequestContext({ user: { id: manager.id }, ip: '198.51.100.9' }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 9999, { entryId: original.id })),
    );

    // Value overwritten; status unchanged (override never advances the workflow).
    expect(detail.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
    expect(detail.heads[0].lines[0].amount).toBe('9999.00');

    // Provenance: enteredBy stays the SPOC; lastModifiedBy becomes the manager.
    const row = await prisma.provisionEntry.findFirstOrThrow({ where: { snapshotId: snapshotIds[0] } });
    expect(row.enteredById).toBe(original.enteredById);
    expect(row.enteredById).not.toBe(manager.id);
    expect(row.lastModifiedById).toBe(manager.id);

    // A fresh read (any user) sees the new canonical value.
    const refetched = await submissions.getDetail(submission.id, manager);
    expect(refetched.heads[0].lines[0].amount).toBe('9999.00');

    // Audited as MANAGER_PROVISION_OVERRIDE with old→new (line identity), actor, and IP.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: submission.id, action: 'MANAGER_PROVISION_OVERRIDE' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].performedById).toBe(manager.id);
    expect(audits[0].ipAddress).toBe('198.51.100.9');
    expect(audits[0].newValue).toEqual([
      { snapshotId: snapshotIds[0], lines: [{ entryId: original.id, amount: 9999 }] },
    ]);
  });

  it('Manager override is allowed in the SUBMITTED stage too (before opening review)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    const id = await entryIdOf(submission.id, manager, snapshotIds[0]);

    const detail = await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 12, { entryId: id })),
    );
    expect(detail.status).toBe(SubmissionStatus.SUBMITTED);
    expect(detail.heads[0].lines[0].amount).toBe('12.00');
  });

  it('Manager override is rejected outside the review stage — e.g. once CLINIC_APPROVED (409)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_APPROVED);

    await expectStatus(entries.saveEntries(submission.id, manager, one(snapshotIds[0], 1)), 409);
  });

  it("Manager cannot override another clinic's submission (403)", async () => {
    const { submission } = await setup(1);
    await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_MANAGER_REVIEW);

    const otherClinic = await fx.makeClinic();
    const outsideManager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [otherClinic.id])).user;
    await expectStatus(entries.saveEntries(submission.id, outsideManager, []), 403);
  });

  // ── SPOC per-line notes ──────────────────────────────────────────────────────

  it('persists a SPOC note with the entry, returns it in detail, and clearing it stores null', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    const saved = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 500, { note: '  spiked due to new equipment  ' }),
      ...one(snapshotIds[1], 100), // no note → null
    ]);
    const line0 = (h: typeof saved) => h.heads.find((x) => x.snapshotId === snapshotIds[0])!.lines[0];
    expect(line0(saved).note).toBe('spiked due to new equipment');
    expect(saved.heads.find((h) => h.snapshotId === snapshotIds[1])!.lines[0].note).toBeNull();

    // Persisted: a fresh read returns the note.
    const refetched = await submissions.getDetail(submission.id, spoc);
    expect(line0(refetched).note).toBe('spiked due to new equipment');

    // Clearing it (whitespace-only) stores null and leaves the amount intact.
    const id = line0(refetched).entryId!;
    const cleared = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 500, { note: '   ', entryId: id }));
    const h0 = cleared.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0];
    expect(h0.note).toBeNull();
    expect(h0.amount).toBe('500.00');
  });

  it('a SPOC note is editable only while SPOC-editable; once submitted the SPOC is rejected (409)', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);

    const draft = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 10, { note: 'editable note' }));
    expect(draft.status).toBe(SubmissionStatus.DRAFT);
    expect(draft.heads[0].lines[0].note).toBe('editable note');

    await workflow.submit(submission.id, spoc);
    await expectStatus(entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 10, { note: 'too late' })), 409);
    expect((await submissions.getDetail(submission.id, spoc)).heads[0].lines[0].note).toBe('editable note');
  });

  it('reviewers receive the SPOC note in detail; a value override leaves the note untouched', async () => {
    const { clinic, submission, spoc, snapshotIds } = await setup(1);
    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 700, { note: 'rent revised in lease renewal' }));
    await workflow.submit(submission.id, spoc);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    expect((await submissions.getDetail(submission.id, manager)).heads[0].lines[0].note).toBe(
      'rent revised in lease renewal',
    );
    expect((await submissions.getDetail(submission.id, finance)).heads[0].lines[0].note).toBe(
      'rent revised in lease renewal',
    );

    // The note is SPOC-owned: a manager value override (only amount is sent) doesn't change it.
    const id = await entryIdOf(submission.id, manager, snapshotIds[0]);
    await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 1234, { entryId: id })),
    );
    const after = await submissions.getDetail(submission.id, manager);
    expect(after.heads[0].lines[0].amount).toBe('1234.00'); // value overridden
    expect(after.heads[0].lines[0].note).toBe('rent revised in lease renewal'); // note preserved
  });

  it('saving a note records no audit row beyond the single PROVISION_SAVE', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);

    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 50, { note: 'just a note' }));

    const provisionAudits = await prisma.auditLog.findMany({
      where: {
        entityId: submission.id,
        action: { in: ['PROVISION_SAVE', 'MANAGER_PROVISION_OVERRIDE', 'PROVISION_EDIT_OVERRIDE'] },
      },
    });
    expect(provisionAudits).toHaveLength(1);
    expect(provisionAudits[0].action).toBe('PROVISION_SAVE');
  });

  // ── SPOC per-line vendor name ────────────────────────────────────────────────

  it('persists a SPOC vendor name with the entry, returns it in detail, and clearing it stores null', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    const saved = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 500, { vendorName: '  Acme Medical Supplies  ' }),
      ...one(snapshotIds[1], 100), // no vendor → null
    ]);
    const l0 = (d: typeof saved) => d.heads.find((x) => x.snapshotId === snapshotIds[0])!.lines[0];
    expect(l0(saved).vendorName).toBe('Acme Medical Supplies');
    expect(saved.heads.find((h) => h.snapshotId === snapshotIds[1])!.lines[0].vendorName).toBeNull();

    const refetched = await submissions.getDetail(submission.id, spoc);
    expect(l0(refetched).vendorName).toBe('Acme Medical Supplies');

    const id = l0(refetched).entryId!;
    const cleared = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 500, { vendorName: '   ', entryId: id }));
    const h0 = cleared.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0];
    expect(h0.vendorName).toBeNull();
    expect(h0.amount).toBe('500.00');
  });

  it('submit succeeds with the vendor name blank — it is optional (completeness rule unchanged)', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);
    await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 100), // no vendor
      ...one(snapshotIds[1], 200, { vendorName: 'Only on one line' }),
    ]);
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  // ── SPOC per-line product code (fixed dropdown set) ───────────────────────────

  it('persists a SPOC product code with the entry, returns it in detail, and clearing it stores null', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    const saved = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 500, { productCode: 'p10' }),
      ...one(snapshotIds[1], 100), // no product code → null
    ]);
    const l0 = (d: typeof saved) => d.heads.find((x) => x.snapshotId === snapshotIds[0])!.lines[0];
    expect(l0(saved).productCode).toBe('p10');
    expect(saved.heads.find((h) => h.snapshotId === snapshotIds[1])!.lines[0].productCode).toBeNull();

    const refetched = await submissions.getDetail(submission.id, spoc);
    expect(l0(refetched).productCode).toBe('p10');

    const id = l0(refetched).entryId!;
    const cleared = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 500, { productCode: '', entryId: id }));
    const h0 = cleared.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0];
    expect(h0.productCode).toBeNull();
    expect(h0.amount).toBe('500.00');
  });

  it('rejects a product code outside the fixed set at the DTO layer (source of the 400)', async () => {
    const invalid = await validate(plainToInstance(ProvisionLineItemDto, { amount: 10, productCode: 'p99' }));
    expect(invalid.some((e) => e.property === 'productCode')).toBe(true);

    const valid = await validate(plainToInstance(ProvisionLineItemDto, { amount: 10, productCode: 'p18' }));
    expect(valid).toHaveLength(0);

    // A blank (null) amount is allowed at the DTO layer (submit enforces it later).
    const blankAmount = await validate(plainToInstance(ProvisionLineItemDto, { amount: null }));
    expect(blankAmount).toHaveLength(0);
  });

  it('submit succeeds with the product code blank — it is optional (completeness rule unchanged)', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);
    await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 100), // no product code
      ...one(snapshotIds[1], 200, { productCode: 'p20' }),
    ]);
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });
});

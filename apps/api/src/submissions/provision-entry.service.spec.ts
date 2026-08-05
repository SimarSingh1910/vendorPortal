import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  PRODUCT_CODES,
  PRODUCT_CODE_DESCRIPTIONS,
  SubmissionStatus,
  UserRole,
  productCodeLabel,
  type ProvisionEntryInput,
} from '@portal/shared';
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
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';

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
        AttachmentsService,
        CorpDepartmentScopeService,
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

  /**
   * One particular carrying a whole amount as rate × 1 — the shorthand these specs
   * use wherever the old typed `amount` used to be. A null amount is a
   * started-but-blank particular (no name/rate/quantity), which submit rejects.
   */
  function amt(amount: number | null, particularId?: string, remark?: string) {
    return amount === null
      ? { particularId, particularName: undefined, rate: null, quantity: null, remark }
      : { particularId, particularName: 'Amount', rate: amount, quantity: 1, remark };
  }

  /** A single-line, single-particular save payload for one head. */
  function one(
    snapshotId: string,
    amount: number | null,
    extras: {
      /** Goes on the ONE particular this helper builds (remarks are per-particular). */
      remark?: string;
      vendorName?: string;
      productCode?: string;
      entryId?: string;
      particularId?: string;
    } = {},
  ): ProvisionEntryInput[] {
    return [
      {
        snapshotId,
        lines: [
          {
            entryId: extras.entryId,
            particulars: [amt(amount, extras.particularId, extras.remark)],
            // Vendor name and product code are BOTH required at submit, so the
            // default helper builds a complete line. Pass '' explicitly for either
            // to model an unfilled/cleared one.
            vendorName: extras.vendorName ?? 'Acme Services',
            productCode: extras.productCode ?? 'P20',
          },
        ],
      },
    ];
  }

  /**
   * The first line + first particular ids of a head. An override targets EXISTING
   * rows, so it needs both — the particular is the level a value now lives at.
   */
  async function firstIds(
    subId: string,
    user: RequestUser,
    snapshotId: string,
  ): Promise<{ entryId: string; particularId: string }> {
    const d = await submissions.getDetail(subId, user);
    const line = d.heads.find((h) => h.snapshotId === snapshotId)!.lines[0];
    return { entryId: line.entryId!, particularId: line.particulars[0].particularId! };
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
          { particulars: [amt(100)], vendorName: 'Vendor A' },
          { particulars: [amt(250)], vendorName: 'Vendor B' },
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
        { snapshotId: snapshotIds[0], lines: [{ particulars: [amt(10)] }, { particulars: [amt(20)] }] },
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
          { particulars: [amt(100)], vendorName: 'Vendor A' },
          { particulars: [amt(250)], vendorName: 'Vendor B' },
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
          { entryId: l0.entryId!, particulars: [amt(999, l0.particulars[0].particularId!)], vendorName: 'Vendor A' },
          { entryId: l1.entryId!, particulars: [amt(250, l1.particulars[0].particularId!)], vendorName: 'Vendor B' },
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
      { snapshotId, lines: [{ particulars: [amt(100)] }, { particulars: [amt(250)] }] },
    ]);
    const both = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    const keep = both.lines[0];

    // Save with only the kept line → the sibling is removed.
    await entries.saveEntries(submission.id, spoc, [
      { snapshotId, lines: [{ entryId: keep.entryId!, particulars: [amt(100, keep.particulars[0].particularId!)] }] },
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

  // ── Particulars: rate × quantity, derived values and derived sums ─────────────

  it('computes value = rate × quantity with decimals, rounded half-up to paise', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId: snapshotIds[0],
        lines: [
          {
            particulars: [
              // 19.99 × 3 = 59.97 exactly — no binary-float drift to 59.96999…
              { particularName: 'Syringes', rate: 19.99, quantity: 3 },
              // 333.335 × 3 = 1000.005 → half-up → 1000.01
              { particularName: 'Reagent', rate: 333.335, quantity: 3 },
              // 0.1 × 3 = 0.30, the classic float trap
              { particularName: 'Swabs', rate: 0.1, quantity: 3 },
            ],
          },
        ],
      },
    ]);

    const head = (await submissions.getDetail(submission.id, spoc)).heads[0];
    expect(head.lines[0].particulars.map((p) => p.value)).toEqual(['59.97', '1000.01', '0.30']);
    // The vendor-line amount is the EXACT sum of the stored values.
    expect(head.lines[0].amount).toBe('1060.28');
  });

  it('derives the vendor-line amount and the head roll-up server-side, ignoring any client total', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: [
          {
            vendorName: 'Acme',
            particulars: [
              { particularName: 'Gloves', rate: 400, quantity: 30 }, // 12,000.00
              { particularName: 'Masks', rate: 15, quantity: 300 }, //  4,500.00
            ],
            // A client asserting its own total must have NO effect — the DTO has no
            // amount field, so this is stripped before the service ever sees it.
            amount: 999999,
          } as never,
          {
            vendorName: 'Beta',
            particulars: [{ particularName: 'Syringes', rate: 9, quantity: 1000 }], // 9,000.00
          },
        ],
      },
    ]);

    const head = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    expect(head.lines.map((l) => l.amount)).toEqual(['16500.00', '9000.00']);

    // The head roll-up equals the sum of the lines, which equals the sum of every
    // stored particular value — no client figure anywhere in the chain.
    const stored = await prisma.entryParticular.findMany({
      where: { entry: { snapshotId } },
    });
    const particularSum = stored.reduce((s, p) => s + Number(p.value), 0);
    expect(particularSum).toBe(25500);
    expect(Number(head.lines[0].amount) + Number(head.lines[1].amount)).toBe(particularSum);
  });

  it('a vendor line requires at least one particular (DTO), and the last one cannot be removed', async () => {
    // Zero particulars is rejected before it reaches the service.
    const none = await validate(plainToInstance(ProvisionLineItemDto, { particulars: [] }));
    expect(none.some((e) => e.property === 'particulars')).toBe(true);

    // A save that keeps one particular succeeds and the row survives; there is no
    // payload shape that leaves a persisted line with zero particulars.
    const { submission, spoc, snapshotIds } = await setup(1);
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId: snapshotIds[0],
        lines: [
          {
            particulars: [
              { particularName: 'A', rate: 10, quantity: 1 },
              { particularName: 'B', rate: 20, quantity: 1 },
            ],
          },
        ],
      },
    ]);
    const head = (await submissions.getDetail(submission.id, spoc)).heads[0];
    expect(head.lines[0].particulars).toHaveLength(2);

    // Drop one — the remaining particular (and its line) is still there.
    const keep = head.lines[0].particulars[0];
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId: snapshotIds[0],
        lines: [
          {
            entryId: head.lines[0].entryId!,
            particulars: [
              { particularId: keep.particularId!, particularName: 'A', rate: 10, quantity: 1 },
            ],
          },
        ],
      },
    ]);
    const after = (await submissions.getDetail(submission.id, spoc)).heads[0];
    expect(after.lines[0].particulars).toHaveLength(1);
    expect(after.lines[0].particulars[0].particularId).toBe(keep.particularId);
    expect(after.lines[0].amount).toBe('10.00');
  });

  it('submit blocks on a particular missing a name/rate/quantity and names it; 0 is valid', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);
    // Vendor + product code present throughout — this test isolates PARTICULAR
    // completeness, so the line-level required fields must never be the fault.
    const save = (particulars: unknown[]) =>
      entries.saveEntries(submission.id, spoc, [
        {
          snapshotId: snapshotIds[0],
          lines: [{ particulars, productCode: 'P20', vendorName: 'Acme Services' }],
        } as never,
      ]);

    // Missing name.
    await save([{ rate: 5, quantity: 2 }]);
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Missing rate (blank ≠ 0).
    await save([{ particularName: 'X', rate: null, quantity: 2 }]);
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Missing quantity.
    await save([{ particularName: 'X', rate: 5, quantity: null }]);
    const err = await workflow.submit(submission.id, spoc).catch((e: Error) => e);
    expect((err as Error).message).toContain('particular 1');
    expect((err as Error).message).toContain('a quantity');

    // All three present, with 0 for both numbers — valid, submit passes.
    await save([{ particularName: 'Zero row', rate: 0, quantity: 0 }]);
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(
      SubmissionStatus.SUBMITTED,
    );
  });

  it('an incomplete particular makes its line amount NULL, not a partial sum', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId: snapshotIds[0],
        lines: [
          {
            particulars: [
              { particularName: 'Done', rate: 100, quantity: 1 },
              // Half-filled: no quantity yet.
              { particularName: 'Pending', rate: 50, quantity: null },
            ],
          },
        ],
      },
    ]);
    const head = (await submissions.getDetail(submission.id, spoc)).heads[0];
    // NOT '100.00' — a line with an incomplete particular has no trustworthy total.
    expect(head.lines[0].amount).toBeNull();
    expect(head.lines[0].particulars.map((p) => p.value)).toEqual(['100.00', null]);
  });

  it('a reviewer override edits particulars and every total re-sums from them', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(
      submission.id,
      SubmissionStatus.CLINIC_MANAGER_REVIEW,
    );
    const before = (await submissions.getDetail(submission.id, manager)).heads[0].lines[0];

    // Override the QUANTITY of the existing particular; the value and the line
    // amount must both follow, without the reviewer ever sending a total.
    await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, [
        {
          snapshotId: snapshotIds[0],
          lines: [
            {
              entryId: before.entryId!,
              particulars: [
                {
                  particularId: before.particulars[0].particularId!,
                  particularName: before.particulars[0].particularName ?? 'Amount',
                  rate: 100,
                  quantity: 2.5,
                },
              ],
            },
          ],
        },
      ]),
    );

    const after = (await submissions.getDetail(submission.id, manager)).heads[0].lines[0];
    expect(after.particulars[0].value).toBe('250.00');
    expect(after.amount).toBe('250.00'); // re-summed, never asserted by the client
    const row = await prisma.provisionEntry.findUniqueOrThrow({ where: { id: before.entryId! } });
    expect(row.amount!.toFixed(2)).toBe('250.00');
  });

  it('submit is blocked while a multi-vendor head has a blank line, and passes once every line has an amount', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    // One filled line + one blank (null-amount) line persisted.
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        // Both lines carry vendor + product code, so the BLANK AMOUNT is the only
        // thing that can block submit here.
        lines: [
          { particulars: [amt(100)], vendorName: 'complete', productCode: 'P20' },
          { particulars: [amt(null)], vendorName: 'incomplete', productCode: 'P20' },
        ],
      },
    ]);
    await expectStatus(workflow.submit(submission.id, spoc), 422);

    // Fill the blank line (carry both ids) → submit succeeds.
    const head = (await submissions.getDetail(submission.id, spoc)).heads.find(
      (h) => h.snapshotId === snapshotId,
    )!;
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: head.lines.map((l) => ({
          entryId: l.entryId!,
          productCode: 'P20',
          // Resent: a SPOC save rewrites the line's fields wholesale, so omitting
          // the vendor here would CLEAR it and re-block submit on a different fault.
          vendorName: l.vendorName ?? 'complete',
          particulars: [amt(Number(l.amount ?? 50), l.particulars[0].particularId!)],
        })),
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
    const ids = await firstIds(submission.id, admin, snapshotIds[0]);

    const detail = await runWithRequestContext({ user: { id: admin.id }, ip: '203.0.113.7' }, () =>
      entries.saveEntries(submission.id, admin, one(snapshotIds[0], 4242, ids)),
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

    const ids = await firstIds(submission.id, manager, snapshotIds[0]);
    const detail = await runWithRequestContext({ user: { id: manager.id }, ip: '198.51.100.9' }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 9999, ids)),
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
    // The audit captures PARTICULAR identity, not just a head amount.
    expect(audits[0].newValue).toEqual([
      {
        snapshotId: snapshotIds[0],
        lines: [
          {
            entryId: original.id,
            productCode: 'P20',
            // Echoed back by the helper that built the payload; the override path
            // ignores it and keeps the SPOC's stored vendor either way.
            vendorName: 'Acme Services',
            particulars: [
              {
                particularId: ids.particularId,
                particularName: 'Amount',
                rate: 9999,
                quantity: 1,
              },
            ],
          },
        ],
      },
    ]);
  });

  it('Manager override is allowed in the SUBMITTED stage too (before opening review)', async () => {
    const { submission, snapshotIds } = await setup(1);
    const { manager } = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    const ids = await firstIds(submission.id, manager, snapshotIds[0]);

    const detail = await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 12, ids)),
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

  // ── SPOC per-PARTICULAR remarks ──────────────────────────────────────────────
  // The explanation used to hang off the vendor line as `note`; it now sits on the
  // particular whose figure it explains. The line carries no free text at all.

  it('persists a SPOC remark on the particular, returns it in detail, and clearing it stores null', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    const saved = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 500, { remark: '  spiked due to new equipment  ' }),
      ...one(snapshotIds[1], 100), // no remark → null
    ]);
    const p0 = (h: typeof saved) =>
      h.heads.find((x) => x.snapshotId === snapshotIds[0])!.lines[0].particulars[0];
    expect(p0(saved).remark).toBe('spiked due to new equipment');
    expect(
      saved.heads.find((h) => h.snapshotId === snapshotIds[1])!.lines[0].particulars[0].remark,
    ).toBeNull();

    // Persisted: a fresh read returns the remark.
    const refetched = await submissions.getDetail(submission.id, spoc);
    expect(p0(refetched).remark).toBe('spiked due to new equipment');

    // Clearing it (whitespace-only) stores null and leaves the value intact.
    const head0 = refetched.heads.find((h) => h.snapshotId === snapshotIds[0])!;
    const cleared = await entries.saveEntries(
      submission.id,
      spoc,
      one(snapshotIds[0], 500, {
        remark: '   ',
        entryId: head0.lines[0].entryId!,
        particularId: head0.lines[0].particulars[0].particularId!,
      }),
    );
    const line = cleared.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0];
    expect(line.particulars[0].remark).toBeNull();
    expect(line.particulars[0].value).toBe('500.00');
    expect(line.amount).toBe('500.00');
  });

  it('a remark is editable only while SPOC-editable; once submitted the SPOC is rejected (409)', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);

    const draft = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 10, { remark: 'editable remark' }));
    expect(draft.status).toBe(SubmissionStatus.DRAFT);
    expect(draft.heads[0].lines[0].particulars[0].remark).toBe('editable remark');

    await workflow.submit(submission.id, spoc);
    await expectStatus(entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 10, { remark: 'too late' })), 409);
    expect(
      (await submissions.getDetail(submission.id, spoc)).heads[0].lines[0].particulars[0].remark,
    ).toBe('editable remark');
  });

  it('reviewers receive the remark in detail; a value override leaves it untouched', async () => {
    const { clinic, submission, spoc, snapshotIds } = await setup(1);
    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 700, { remark: 'rent revised in lease renewal' }));
    await workflow.submit(submission.id, spoc);

    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    const remarkFor = async (user: RequestUser) =>
      (await submissions.getDetail(submission.id, user)).heads[0].lines[0].particulars[0].remark;
    expect(await remarkFor(manager)).toBe('rent revised in lease renewal');
    expect(await remarkFor(finance)).toBe('rent revised in lease renewal');

    // The remark is SPOC-owned: a manager override rewrites the rate/quantity and
    // leaves the remark exactly as the SPOC wrote it — even when the override
    // payload carries a different one.
    const ids = await firstIds(submission.id, manager, snapshotIds[0]);
    await runWithRequestContext({ user: { id: manager.id } }, () =>
      entries.saveEntries(submission.id, manager, one(snapshotIds[0], 1234, { ...ids, remark: 'reviewer text' })),
    );
    const after = await submissions.getDetail(submission.id, manager);
    expect(after.heads[0].lines[0].amount).toBe('1234.00'); // value overridden
    expect(after.heads[0].lines[0].particulars[0].remark).toBe('rent revised in lease renewal');
  });

  it('saving a remark records no audit row beyond the single PROVISION_SAVE', async () => {
    const { submission, spoc, snapshotIds } = await setup(1);

    await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 50, { remark: 'just a remark' }));

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
      ...one(snapshotIds[1], 100, { vendorName: '' }), // left unfilled → stored null
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

  it('submit is BLOCKED while a vendor name is blank, and passes once every line has one', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);
    await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 100, { vendorName: '' }), // unfilled
      ...one(snapshotIds[1], 200, { vendorName: 'Only on one line' }),
    ]);

    // A partial draft SAVES fine — the vendor is only required to submit, exactly
    // like the product code. It is stored as null, never coerced to a placeholder.
    const draft = await submissions.getDetail(submission.id, spoc);
    expect(draft.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0].vendorName).toBeNull();
    expect(draft.status).toBe(SubmissionStatus.DRAFT);

    const err = await workflow.submit(submission.id, spoc).catch((e: Error) => e);
    expect((err as Error).message).toContain('needs a vendor name');

    // Fill it → submit passes.
    const id = draft.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0].entryId!;
    await entries.saveEntries(
      submission.id,
      spoc,
      one(snapshotIds[0], 100, { vendorName: 'Acme Medical Supplies', entryId: id }),
    );
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  // ── SPOC per-line product code (fixed dropdown set) ───────────────────────────

  it('persists a SPOC product code with the entry, returns it in detail, and clearing it stores null', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);

    const saved = await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 500, { productCode: 'P10' }),
      ...one(snapshotIds[1], 100, { productCode: '' }), // left unfilled -> stored null → null
    ]);
    const l0 = (d: typeof saved) => d.heads.find((x) => x.snapshotId === snapshotIds[0])!.lines[0];
    expect(l0(saved).productCode).toBe('P10');
    expect(saved.heads.find((h) => h.snapshotId === snapshotIds[1])!.lines[0].productCode).toBeNull();

    const refetched = await submissions.getDetail(submission.id, spoc);
    expect(l0(refetched).productCode).toBe('P10');

    const id = l0(refetched).entryId!;
    const cleared = await entries.saveEntries(submission.id, spoc, one(snapshotIds[0], 500, { productCode: '', entryId: id }));
    const h0 = cleared.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0];
    expect(h0.productCode).toBeNull();
    expect(h0.amount).toBe('500.00');
  });

  it('rejects a product code outside the fixed set at the DTO layer (source of the 400)', async () => {
    const unknown = await validate(
      plainToInstance(ProvisionLineItemDto, { particulars: [amt(10)], productCode: 'P99' }),
    );
    expect(unknown.some((e) => e.property === 'productCode')).toBe(true);

    // Case matters: the retired lowercase demo codes are no longer valid values.
    const lowercase = await validate(
      plainToInstance(ProvisionLineItemDto, { particulars: [amt(10)], productCode: 'p10' }),
    );
    expect(lowercase.some((e) => e.property === 'productCode')).toBe(true);

    const valid = await validate(plainToInstance(ProvisionLineItemDto, { particulars: [amt(10)], productCode: 'P18' }));
    expect(valid).toHaveLength(0);

    // A blank (null) amount is allowed at the DTO layer (submit enforces it later).
    const blankAmount = await validate(plainToInstance(ProvisionLineItemDto, { particulars: [amt(null)] }));
    expect(blankAmount).toHaveLength(0);
  });

  it('the product-code list is exactly the six real finance codes, with labels and no “PC”', async () => {
    expect([...PRODUCT_CODES]).toEqual(['P27', 'P21', 'P20', 'P18', 'P17', 'P10']);
    // "PC" is the sheet's column header, not a code — it must never be an option.
    expect(PRODUCT_CODES).not.toContain('PC' as never);

    // The dropdown label is "Code - Description"; the stored value stays the code.
    expect(productCodeLabel('P27')).toBe('P27 - NCV / VAS');
    expect(productCodeLabel('P21')).toBe('P21 - Dental Rental');
    expect(productCodeLabel('P10')).toBe('P10 - Care Plan');
    // A code that isn't in the list still renders (a retired historical value).
    expect(productCodeLabel('p10')).toBe('p10');

    // Every code the server accepts has a label — the two cannot drift.
    for (const code of PRODUCT_CODES) {
      expect(productCodeLabel(code)).toBe(`${code} - ${PRODUCT_CODE_DESCRIPTIONS[code]}`);
    }

    // Each one really is accepted by the server-side validation.
    for (const code of PRODUCT_CODES) {
      const ok = await validate(
        plainToInstance(ProvisionLineItemDto, { particulars: [amt(10)], productCode: code }),
      );
      expect(ok).toHaveLength(0);
    }
  });

  it('submit is BLOCKED while a product code is blank, and passes once every line has one', async () => {
    const { submission, spoc, snapshotIds } = await setup(2);
    await entries.saveEntries(submission.id, spoc, [
      ...one(snapshotIds[0], 100, { productCode: '' }), // unfilled
      ...one(snapshotIds[1], 200, { productCode: 'P20' }),
    ]);

    // A partial draft SAVES fine — the code is only required to submit, exactly
    // like rate and quantity. It is stored as null, never coerced.
    const draft = await submissions.getDetail(submission.id, spoc);
    expect(draft.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0].productCode).toBeNull();
    expect(draft.status).toBe(SubmissionStatus.DRAFT);

    const err = await workflow.submit(submission.id, spoc).catch((e: Error) => e);
    expect((err as Error).message).toContain('needs a product code');

    // Fill it → submit passes.
    const id = draft.heads.find((h) => h.snapshotId === snapshotIds[0])!.lines[0].entryId!;
    await entries.saveEntries(
      submission.id,
      spoc,
      one(snapshotIds[0], 100, { productCode: 'P17', entryId: id }),
    );
    await workflow.submit(submission.id, spoc);
    expect((await submissions.getDetail(submission.id, spoc)).status).toBe(SubmissionStatus.SUBMITTED);
  });

  it('names the offending VENDOR LINE when a multi-vendor head is missing a code', async () => {
    const { submission, spoc, snapshotId } = await setupMulti();
    await entries.saveEntries(submission.id, spoc, [
      {
        snapshotId,
        lines: [
          { particulars: [amt(100)], productCode: 'P20', vendorName: 'Vendor A' },
          // Line 2 has no code (its vendor IS filled, so the code is the only fault).
          { particulars: [amt(250)], vendorName: 'Vendor B' },
        ],
      },
    ]);
    const err = await workflow.submit(submission.id, spoc).catch((e: Error) => e);
    expect((err as Error).message).toContain('line 2 needs a product code');
  });
});

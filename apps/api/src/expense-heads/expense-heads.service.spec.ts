import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditAction, SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { ExpenseHeadsService } from './expense-heads.service';
import { CreateExpenseHeadDto } from './dto/create-expense-head.dto';
import { UpdateExpenseHeadDto } from './dto/update-expense-head.dto';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';

describe('ExpenseHeadsService (G/L account expense heads)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ExpenseHeadsService;
  let cycle: CycleService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        ExpenseHeadsService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        AttachmentsService,
        CorpDepartmentScopeService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ExpenseHeadsService);
    cycle = moduleRef.get(CycleService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('create persists glAccountNo + glAccountName; the list returns them', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
    expect(head).toMatchObject({ glAccountNo: '400100', glAccountName: 'Radiology Services' });

    const list = await service.list('all');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
  });

  it('rejects a duplicate glAccountNo on create with a 409 Conflict', async () => {
    await service.create({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
    await expect(
      service.create({ glAccountNo: '400100', glAccountName: 'Something Else' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an update that collides with another head’s glAccountNo (409 Conflict)', async () => {
    await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    const power = await service.create({ glAccountNo: '400200', glAccountName: 'Power' });
    await expect(service.update(power.id, { glAccountNo: '400100' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('the CreateExpenseHeadDto requires BOTH G/L fields', async () => {
    const missingNo = await validate(plainToInstance(CreateExpenseHeadDto, { glAccountName: 'Rent' }));
    expect(missingNo.some((e) => e.property === 'glAccountNo')).toBe(true);

    const missingName = await validate(plainToInstance(CreateExpenseHeadDto, { glAccountNo: '400100' }));
    expect(missingName.some((e) => e.property === 'glAccountName')).toBe(true);

    const ok = await validate(
      plainToInstance(CreateExpenseHeadDto, { glAccountNo: '400100', glAccountName: 'Rent' }),
    );
    expect(ok).toHaveLength(0);
  });

  // ── Admin-set multi-vendor flag ──────────────────────────────────────────────

  it('defaults a new head to single-vendor and lets an admin turn multi-vendor on and back off', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    expect(head.allowsMultipleVendors).toBe(false); // NOT multi-vendor unless asked

    const on = await service.update(head.id, { allowsMultipleVendors: true });
    expect(on.allowsMultipleVendors).toBe(true);
    // The flag survives an unrelated edit rather than being reset by omission.
    const renamed = await service.update(head.id, { glAccountName: 'Rent & Rates' });
    expect(renamed.allowsMultipleVendors).toBe(true);
    expect(renamed.glAccountName).toBe('Rent & Rates');

    const off = await service.update(head.id, { allowsMultipleVendors: false });
    expect(off.allowsMultipleVendors).toBe(false);
  });

  it('accepts the flag at create time and exposes it on the list', async () => {
    await service.create({
      glAccountNo: '41117004',
      glAccountName: 'Other Outsourced Services',
      allowsMultipleVendors: true,
    });
    const list = await service.list('all');
    expect(list[0].allowsMultipleVendors).toBe(true);
  });

  it('the DTOs accept an optional boolean flag and reject a non-boolean', async () => {
    const omitted = await validate(
      plainToInstance(CreateExpenseHeadDto, { glAccountNo: '400100', glAccountName: 'Rent' }),
    );
    expect(omitted).toHaveLength(0); // optional

    const wrongType = await validate(
      plainToInstance(CreateExpenseHeadDto, {
        glAccountNo: '400100',
        glAccountName: 'Rent',
        allowsMultipleVendors: 'yes',
      }),
    );
    expect(wrongType.some((e) => e.property === 'allowsMultipleVendors')).toBe(true);

    const ok = await validate(
      plainToInstance(UpdateExpenseHeadDto, { allowsMultipleVendors: true }),
    );
    expect(ok).toHaveLength(0);
  });

  it('toggling the flag is captured in the audit trail as a real old→new change', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await service.update(head.id, { allowsMultipleVendors: true });

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.EXPENSE_HEAD_UPDATE, entityId: head.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ allowsMultipleVendors: false });
    expect(rows[0].newValue).toMatchObject({ allowsMultipleVendors: true });
  });

  it('turning multi-vendor ON reaches months that are ALREADY open (and the next one too)', async () => {
    const clinic = await fx.makeClinic();
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await fx.mapHeads(clinic.id, [head.id]);

    // Month opened while the head is single-vendor.
    const open = await cycle.openClinicCycle(clinic.id, '2026-06');
    const snapId = (
      await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
        where: { submissionId: open.submission.id, expenseHeadId: head.id },
      })
    ).id;
    expect(
      (await prisma.submissionExpenseHeadSnapshot.findUniqueOrThrow({ where: { id: snapId } }))
        .expenseHeadAllowsMultipleVendorsAtSnapshot,
    ).toBe(false);

    // Admin ticks the box AFTERWARDS — the SPOC entering this month sees it now,
    // without waiting for the next cycle.
    await service.update(head.id, { allowsMultipleVendors: true });
    expect(
      (await prisma.submissionExpenseHeadSnapshot.findUniqueOrThrow({ where: { id: snapId } }))
        .expenseHeadAllowsMultipleVendorsAtSnapshot,
    ).toBe(true);

    // And a newly opened month still picks up the current setting.
    const next = await cycle.openClinicCycle(clinic.id, '2026-07');
    const nextSnap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: next.submission.id, expenseHeadId: head.id },
    });
    expect(nextSnap.expenseHeadAllowsMultipleVendorsAtSnapshot).toBe(true);
  });

  it('an APPROVED (locked) month is never rewritten by a later toggle', async () => {
    const clinic = await fx.makeClinic();
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-06');
    await fx.valueAllHeads(submission.id);
    await fx.driveToStatus(submission.id, SubmissionStatus.FINANCE_APPROVED);

    await service.update(head.id, { allowsMultipleVendors: true });

    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId: head.id },
    });
    // The approved record keeps the rules it was approved under.
    expect(snap.expenseHeadAllowsMultipleVendorsAtSnapshot).toBe(false);
  });

  it('turning it OFF never strands vendor rows a SPOC already entered', async () => {
    const clinic = await fx.makeClinic();
    const head = await service.create({
      glAccountNo: '400100',
      glAccountName: 'Outsourced',
      allowsMultipleVendors: true,
    });
    await fx.mapHeads(clinic.id, [head.id]);

    // One open month with TWO vendor lines entered, one with none.
    const used = await cycle.openClinicCycle(clinic.id, '2026-06');
    const untouched = await cycle.openClinicCycle(clinic.id, '2026-07');
    const usedSnap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: used.submission.id, expenseHeadId: head.id },
    });
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    for (const lineOrder of [0, 1]) {
      await prisma.provisionEntry.create({
        data: {
          submissionId: used.submission.id,
          snapshotId: usedSnap.id,
          lineOrder,
          enteredById: spoc.id,
          lastModifiedById: spoc.id,
        },
      });
    }

    await service.update(head.id, { allowsMultipleVendors: false });

    // The month holding two lines KEEPS multi-vendor — flipping it would leave
    // rows the UI can't render and the API would reject on the next save.
    expect(
      (await prisma.submissionExpenseHeadSnapshot.findUniqueOrThrow({ where: { id: usedSnap.id } }))
        .expenseHeadAllowsMultipleVendorsAtSnapshot,
    ).toBe(true);

    // The month with nothing entered flips cleanly.
    const untouchedSnap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: untouched.submission.id, expenseHeadId: head.id },
    });
    expect(untouchedSnap.expenseHeadAllowsMultipleVendorsAtSnapshot).toBe(false);
  });

  it('records what the toggle actually reached in the audit trail', async () => {
    const clinic = await fx.makeClinic();
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await fx.mapHeads(clinic.id, [head.id]);
    await cycle.openClinicCycle(clinic.id, '2026-06');

    await service.update(head.id, { allowsMultipleVendors: true });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: AuditAction.EXPENSE_HEAD_UPDATE, entityId: head.id },
    });
    expect(row.newValue).toMatchObject({
      allowsMultipleVendors: true,
      snapshotPropagation: { updated: 1, skippedWithExistingLines: 0 },
    });
  });

  it('the update audit old→new payload uses the G/L field keys', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await service.update(head.id, { glAccountName: 'Radiology Services' });

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.EXPENSE_HEAD_UPDATE, entityId: head.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ glAccountNo: '400100', glAccountName: 'Rent' });
    expect(rows[0].newValue).toMatchObject({ glAccountName: 'Radiology Services' });
  });
});

import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { ExportService } from './export.service';
import { ExcelExportService } from './excel-export.service';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { resetDb } from '../../test/reset';
import type { RequestUser } from '../auth/request-user';

/** FR-10 export data feed + ExcelJS output validity. */
describe('Export (Phase 12, FR-10)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let exportService: ExportService;
  let excel: ExcelExportService;
  let fx: Fixtures;
  let finance: RequestUser;
  let spocId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        AuditService,
        CycleService,
        WorkflowService,
        ExportService,
        ExcelExportService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    exportService = moduleRef.get(ExportService);
    excel = moduleRef.get(ExcelExportService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    spocId = (await fx.makeUser(UserRole.CLINIC_SPOC)).user.id;
  });

  async function enter(
    clinicId: string,
    month: string,
    headAmounts: Array<{ id: string; amount: number }>,
    status: SubmissionStatus = SubmissionStatus.SUBMITTED,
  ) {
    const { submission } = await cycle.openClinicCycle(clinicId, month);
    await prisma.monthlySubmission.update({ where: { id: submission.id }, data: { status } });
    for (const { id, amount } of headAmounts) {
      const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
        where: { submissionId: submission.id, expenseHeadId: id },
      });
      await prisma.provisionEntry.create({
        data: { submissionId: submission.id, snapshotId: snap.id, amount, enteredById: spocId, lastModifiedById: spocId },
      });
    }
  }

  it('clinic-month export yields the right rows/total and a valid .xlsx', async () => {
    const clinic = await fx.makeClinic({ name: 'Pune' });
    const rent = await fx.makeExpenseHead({ name: 'Rent', category: 'Facilities' });
    const power = await fx.makeExpenseHead({ name: 'Power', category: 'Utilities' });
    await fx.mapHeads(clinic.id, [rent.id, power.id]);
    await enter(clinic.id, '2026-06', [
      { id: rent.id, amount: 1000 },
      { id: power.id, amount: 250 },
    ]);

    const data = await exportService.clinicMonth(finance, clinic.id, '2026-06');
    expect(data.total).toBe('1250.00');
    expect(data.rows).toHaveLength(2);

    // Produces a non-empty, valid .xlsx (ZIP container — "PK" magic bytes).
    const buffer = await excel.clinicMonth(data);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('detail rows honor the status filter (regression: filter must apply)', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-05', [{ id: head.id, amount: 100 }], SubmissionStatus.FINANCE_APPROVED);
    await enter(clinic.id, '2026-06', [{ id: head.id, amount: 200 }], SubmissionStatus.DRAFT);

    const all = await exportService.detailRows(finance, {});
    expect(all).toHaveLength(2);

    const approvedOnly = await exportService.detailRows(finance, {
      status: [SubmissionStatus.FINANCE_APPROVED],
    });
    expect(approvedOnly.map((r) => r.amount)).toEqual(['100.00']);
  });

  it('month-end report includes active clinics only, as a head×clinic matrix', async () => {
    const a = await fx.makeClinic({ name: 'Active A' });
    const b = await fx.makeClinic({ name: 'Active B' });
    const dead = await fx.makeClinic({ name: 'Dead', active: true });
    const head = await fx.makeExpenseHead({ name: 'Rent' });
    await fx.mapHeads(a.id, [head.id]);
    await fx.mapHeads(b.id, [head.id]);
    await fx.mapHeads(dead.id, [head.id]);
    const month = new Date().toISOString().slice(0, 7); // current month, lenient
    await enter(a.id, month, [{ id: head.id, amount: 300 }]);
    await enter(b.id, month, [{ id: head.id, amount: 700 }]);
    await enter(dead.id, month, [{ id: head.id, amount: 999 }]);
    // Deactivate AFTER seeding: its history stays, but month-end excludes it.
    await prisma.clinic.update({ where: { id: dead.id }, data: { isActive: false } });

    const data = await exportService.monthEnd(finance, month);

    expect(data.clinics.map((c) => c.name)).toEqual(['Active A', 'Active B']); // no Dead
    expect(data.heads.map((h) => h.name)).toEqual(['Rent']);
    expect(data.amounts[head.id][a.id]).toBe('300.00');
    expect(data.amounts[head.id][b.id]).toBe('700.00');

    // Builds a valid (non-empty, ZIP-container) workbook.
    const buffer = await excel.monthEnd(data);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('scopes exports to a clinic role and blocks out-of-scope single-clinic export', async () => {
    const mine = await fx.makeClinic({ name: 'Mine' });
    const other = await fx.makeClinic({ name: 'Other' });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(mine.id, [head.id]);
    await fx.mapHeads(other.id, [head.id]);
    await enter(mine.id, '2026-06', [{ id: head.id, amount: 100 }]);
    await enter(other.id, '2026-06', [{ id: head.id, amount: 500 }]);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [mine.id])).user;

    const rows = await exportService.detailRows(spoc, {});
    expect(rows.map((r) => r.clinicName)).toEqual(['Mine']);

    // Single-clinic export of a clinic outside scope is forbidden (403).
    await expectStatus(exportService.clinicMonth(spoc, other.id, '2026-06'), 403);
  });
});

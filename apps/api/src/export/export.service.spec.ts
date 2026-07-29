import { Test, type TestingModule } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import {
  SubmissionStatus,
  UserRole,
  computeValueMinor,
  minorToDecimalString,
} from '@portal/shared';
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
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';

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
        AttachmentsService,
        CorpDepartmentScopeService,
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

  /**
   * Seed a vendor line WITH its particulars. `amount` is shorthand for the common
   * one-particular line (rate = amount × qty 1), so a line's derived amount equals
   * `amount`; pass `particulars` to build a line out of several rate/quantity rows.
   */
  async function enter(
    clinicId: string,
    month: string,
    lines: Array<{
      id: string;
      amount: number;
      productCode?: string;
      vendorName?: string;
      note?: string;
      particulars?: Array<{ name: string; rate: number; quantity: number }>;
    }>,
    status: SubmissionStatus = SubmissionStatus.SUBMITTED,
  ) {
    const { submission } = await cycle.openClinicCycle(clinicId, month);
    await prisma.monthlySubmission.update({ where: { id: submission.id }, data: { status } });
    for (const { id, amount, productCode, vendorName, note, particulars } of lines) {
      const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
        where: { submissionId: submission.id, expenseHeadId: id },
      });
      const rows = particulars ?? [{ name: 'Amount', rate: amount, quantity: 1 }];
      const values = rows.map((p) => computeValueMinor(p.rate, p.quantity)!);
      await prisma.provisionEntry.create({
        data: {
          submissionId: submission.id,
          snapshotId: snap.id,
          amount: minorToDecimalString(values.reduce((a, b) => a + b, 0n)),
          productCode: productCode ?? null,
          vendorName: vendorName ?? null,
          note: note ?? null,
          enteredById: spocId,
          lastModifiedById: spocId,
          particulars: {
            create: rows.map((p, i) => ({
              lineOrder: i,
              particularName: p.name,
              rate: String(p.rate),
              quantity: String(p.quantity),
              value: minorToDecimalString(values[i]),
            })),
          },
        },
      });
    }
  }

  // The finance manager's unified layout — EXACT order + headers. The original ten
  // keep their positions; Particular/Rate/Quantity are appended at 11-13 for the
  // per-particular grain.
  const EXPECTED_HEADERS = [
    'G/L Account No.',
    'G/L Account Name',
    'Month',
    'Description',
    'Amount (LCY)',
    'Vendor Name',
    'Clinic Name',
    'Acc. Location Code',
    'Customer Code',
    'Product Code',
    'Particular',
    'Rate',
    'Quantity',
  ];
  /** The ten columns that predate particulars — these must never move or rename. */
  const LEGACY_HEADERS = EXPECTED_HEADERS.slice(0, 10);
  const col = (h: string) => EXPECTED_HEADERS.indexOf(h) + 1; // 1-based cell index

  /** Load a produced .xlsx back and expose row 1 headers + the data rows by column. */
  async function loadSheet(buffer: Buffer) {
    const wb = new Workbook();
    // Cast around the @types/node generic-Buffer vs exceljs Buffer variance.
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.worksheets[0];
    const headers = EXPECTED_HEADERS.map((_, i) => sheet.getRow(1).getCell(i + 1).value);
    const dataRows: Array<Record<string, unknown>> = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const record: Record<string, unknown> = {};
      EXPECTED_HEADERS.forEach((h, i) => (record[h] = row.getCell(i + 1).value));
      dataRows.push(record);
    }
    return { sheet, headers, dataRows };
  }

  it('all three clinic exports produce EXACTLY the finance columns in order (no extra column)', async () => {
    const clinic = await fx.makeClinic({ name: 'Pune' });
    const head = await fx.makeExpenseHead({ glAccountName: 'Rent', glAccountNo: '400100' });
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', [{ id: head.id, amount: 1000 }]);

    const individual = await excel.clinicMonth(await exportService.clinicMonth(finance, clinic.id, '2026-06'));
    const consolidated = await excel.consolidated(await exportService.detailRows(finance, {}));
    const monthEnd = await excel.monthEnd(await exportService.monthEnd(finance, '2026-06'));

    for (const buffer of [individual, consolidated, monthEnd]) {
      expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK'); // valid xlsx (ZIP)
      const { sheet, headers } = await loadSheet(buffer);
      expect(headers).toEqual(EXPECTED_HEADERS);
      // The pre-existing finance columns keep their EXACT names and positions —
      // the particulars work appended, it did not reorder.
      expect(headers.slice(0, 10)).toEqual(LEGACY_HEADERS);
      // No 14th column bleeds in beyond the fixed layout.
      expect(sheet.getRow(1).getCell(EXPECTED_HEADERS.length + 1).value ?? null).toBeNull();
    }
  });

  it('consolidated across 2 clinics × 2 months writes Month + Clinic Name on EVERY row', async () => {
    const pune = await fx.makeClinic({ name: 'Pune', accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
    const mum = await fx.makeClinic({ name: 'Mumbai', accLocationCode: 'LOC-MUM', customerCode: 'CUST-MUM' });
    const rent = await fx.makeExpenseHead({ glAccountName: 'Rent', glAccountNo: '400100' });
    await fx.mapHeads(pune.id, [rent.id]);
    await fx.mapHeads(mum.id, [rent.id]);
    await enter(pune.id, '2026-05', [{ id: rent.id, amount: 100 }]);
    await enter(pune.id, '2026-06', [{ id: rent.id, amount: 200 }]);
    await enter(mum.id, '2026-05', [{ id: rent.id, amount: 300 }]);
    await enter(mum.id, '2026-06', [{ id: rent.id, amount: 400 }]);

    const buffer = await excel.consolidated(await exportService.detailRows(finance, {}));
    const { dataRows } = await loadSheet(buffer);
    expect(dataRows).toHaveLength(4);

    // Every row carries its own Month + Clinic Name (never a section heading).
    expect(dataRows.every((r) => r['Month'] === '2026-05' || r['Month'] === '2026-06')).toBe(true);
    expect(dataRows.every((r) => r['Clinic Name'] === 'Pune' || r['Clinic Name'] === 'Mumbai')).toBe(true);

    // The (clinic, month) → amount mapping is unambiguous from each row alone.
    const key = (r: Record<string, unknown>) => `${r['Clinic Name']}|${r['Month']}`;
    const byKey = new Map(dataRows.map((r) => [key(r), r]));
    expect(byKey.get('Pune|2026-05')!['Amount (LCY)']).toBe(100);
    expect(byKey.get('Pune|2026-06')!['Amount (LCY)']).toBe(200);
    expect(byKey.get('Mumbai|2026-05')!['Amount (LCY)']).toBe(300);
    expect(byKey.get('Mumbai|2026-06')!['Amount (LCY)']).toBe(400);
    // Per-clinic codes repeat correctly on that clinic's rows.
    expect(byKey.get('Pune|2026-05')!['Acc. Location Code']).toBe('LOC-PUN');
    expect(byKey.get('Mumbai|2026-06')!['Customer Code']).toBe('CUST-MUM');
  });

  it('per-line values vary and per-clinic values repeat; Description = the per-line SPOC note', async () => {
    const clinic = await fx.makeClinic({ name: 'Pune', accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
    const rent = await fx.makeExpenseHead({ glAccountName: 'Rent', glAccountNo: '400100' });
    const power = await fx.makeExpenseHead({ glAccountName: 'Power', glAccountNo: '400200' });
    await fx.mapHeads(clinic.id, [rent.id, power.id]);
    await enter(clinic.id, '2026-06', [
      { id: rent.id, amount: 1000, vendorName: 'Landlord LLP', productCode: 'P10', note: 'lease renewed' },
      { id: power.id, amount: 250 }, // no vendor / product / note
    ]);

    const buffer = await excel.clinicMonth(await exportService.clinicMonth(finance, clinic.id, '2026-06'));
    const { dataRows } = await loadSheet(buffer);
    expect(dataRows).toHaveLength(2);
    const [rentRow, powerRow] = dataRows; // ordered by G/L No. (400100, 400200)

    // Per-line fields vary per row.
    expect(rentRow['G/L Account No.']).toBe('400100');
    expect(rentRow['Amount (LCY)']).toBe(1000);
    expect(rentRow['Vendor Name']).toBe('Landlord LLP');
    expect(rentRow['Product Code']).toBe('P10');
    expect(rentRow['Description']).toBe('lease renewed'); // Description = per-line SPOC note

    // Per-clinic fields repeat identically across the clinic's lines.
    expect(rentRow['Clinic Name']).toBe('Pune');
    expect(powerRow['Clinic Name']).toBe('Pune');
    expect(rentRow['Acc. Location Code']).toBe('LOC-PUN');
    expect(powerRow['Acc. Location Code']).toBe('LOC-PUN');
    expect(rentRow['Customer Code']).toBe('CUST-PUN');
    expect(powerRow['Customer Code']).toBe('CUST-PUN');

    // A null vendor / product / description renders BLANK (never "0"/"null").
    for (const field of ['Vendor Name', 'Product Code', 'Description']) {
      const v = powerRow[field];
      expect(v == null || v === '').toBe(true);
      expect(v).not.toBe(0);
      expect(v).not.toBe('null');
    }
    // Amount is a live number with the en-IN Indian-grouping format.
    const amountCell = (await loadSheet(buffer)).sheet.getRow(2).getCell(col('Amount (LCY)'));
    expect(typeof amountCell.value).toBe('number');
    expect(String(amountCell.numFmt)).toContain('##,##'); // Indian (lakh/crore) grouping
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

  it('emits one row per vendor line for a multi-vendor head (repeated G/L No./Name), excluding blank lines', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead({
      glAccountName: 'Other Outsourced Services',
      glAccountNo: '41117004',
      allowsMultipleVendors: true,
    });
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-06');
    await prisma.monthlySubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.SUBMITTED },
    });
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id, expenseHeadId: head.id },
    });
    const line = (lineOrder: number, vendorName: string, amount: number | null) => ({
      submissionId: submission.id,
      snapshotId: snap.id,
      lineOrder,
      amount: amount === null ? null : String(amount.toFixed(2)),
      vendorName,
      enteredById: spocId,
      lastModifiedById: spocId,
      particulars: {
        create: [
          amount === null
            ? // A started-but-blank particular: no rate/quantity, so no value.
              { lineOrder: 0, particularName: null, rate: null, quantity: null, value: null }
            : {
                lineOrder: 0,
                particularName: 'Amount',
                rate: String(amount),
                quantity: '1',
                value: amount.toFixed(2),
              },
        ],
      },
    });
    await prisma.provisionEntry.create({ data: line(0, 'Quess Corp', 100) });
    await prisma.provisionEntry.create({ data: line(1, 'Sodexo', 250) });
    // A blank (null-amount) line must NOT appear as a "0" row.
    await prisma.provisionEntry.create({ data: line(2, 'Draft only', null) });

    const rows = await exportService.detailRows(finance, { clinicId: clinic.id, month: '2026-06' });
    expect(rows).toHaveLength(2); // two real lines; the blank line is excluded
    // Same frozen G/L No./Name on every line of the head; vendor + amount differ.
    expect(rows.map((r) => r.glAccountNo)).toEqual(['41117004', '41117004']);
    expect(rows.map((r) => r.glAccountName)).toEqual([
      'Other Outsourced Services',
      'Other Outsourced Services',
    ]);
    expect(rows.map((r) => r.vendorName)).toEqual(['Quess Corp', 'Sodexo']);
    expect(rows.map((r) => r.amount)).toEqual(['100.00', '250.00']);
  });

  it('emits one row per PARTICULAR, repeating the line context, and still totals the same', async () => {
    const clinic = await fx.makeClinic({ name: 'Pune', accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
    const head = await fx.makeExpenseHead({ glAccountName: 'Consumables', glAccountNo: '500100' });
    await fx.mapHeads(clinic.id, [head.id]);
    await enter(clinic.id, '2026-06', [
      {
        id: head.id,
        amount: 0, // ignored — particulars drive the figures
        vendorName: 'Acme',
        productCode: 'P20',
        note: 'monthly consumables',
        particulars: [
          { name: 'Gloves (M)', rate: 400, quantity: 30 }, // 12,000.00
          { name: 'Masks', rate: 15, quantity: 300 }, //  4,500.00
        ],
      },
    ]);

    const rows = await exportService.detailRows(finance, { clinicId: clinic.id, month: '2026-06' });
    // One row per particular — NOT one per vendor line.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.particularName)).toEqual(['Gloves (M)', 'Masks']);
    expect(rows.map((r) => r.amount)).toEqual(['12000.00', '4500.00']);
    // The line/head/clinic context repeats down the particulars.
    expect(rows.map((r) => r.glAccountNo)).toEqual(['500100', '500100']);
    expect(rows.map((r) => r.vendorName)).toEqual(['Acme', 'Acme']);
    expect(rows.map((r) => r.productCode)).toEqual(['P20', 'P20']);
    expect(rows.map((r) => r.note)).toEqual(['monthly consumables', 'monthly consumables']);
    expect(rows.map((r) => r.clinicName)).toEqual(['Pune', 'Pune']);

    // The Amount column still sums to the vendor line's stored amount — the grain
    // changed, the grand total did not.
    const sheetTotal = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const stored = await prisma.provisionEntry.findFirstOrThrow({
      where: { submission: { clinicId: clinic.id } },
    });
    expect(sheetTotal).toBe(Number(stored.amount));
    expect(sheetTotal).toBe(16500);

    // Rate and Quantity land in the appended columns, as real numbers.
    const { dataRows } = await loadSheet(await excel.consolidated(rows));
    expect(dataRows.map((r) => r['Particular'])).toEqual(['Gloves (M)', 'Masks']);
    expect(dataRows.map((r) => r['Rate'])).toEqual([400, 15]);
    expect(dataRows.map((r) => r['Quantity'])).toEqual([30, 300]);
    expect(dataRows.map((r) => r['Amount (LCY)'])).toEqual([12000, 4500]);
  });

  it('month-end is one row per line for ACTIVE clinics only (no matrix, no dead clinics)', async () => {
    const a = await fx.makeClinic({ name: 'Active A' });
    const b = await fx.makeClinic({ name: 'Active B' });
    const dead = await fx.makeClinic({ name: 'Dead', active: true });
    const head = await fx.makeExpenseHead({ glAccountName: 'Rent', glAccountNo: '400100' });
    await fx.mapHeads(a.id, [head.id]);
    await fx.mapHeads(b.id, [head.id]);
    await fx.mapHeads(dead.id, [head.id]);
    const month = new Date().toISOString().slice(0, 7); // current month, lenient
    await enter(a.id, month, [{ id: head.id, amount: 300 }]);
    await enter(b.id, month, [{ id: head.id, amount: 700 }]);
    await enter(dead.id, month, [{ id: head.id, amount: 999 }]);
    // Deactivate AFTER seeding: its history stays, but month-end excludes it.
    await prisma.clinic.update({ where: { id: dead.id }, data: { isActive: false } });

    const rows = await exportService.monthEnd(finance, month);
    expect(rows.map((r) => r.clinicName).sort()).toEqual(['Active A', 'Active B']); // no Dead

    const buffer = await excel.monthEnd(rows);
    const { dataRows } = await loadSheet(buffer);
    expect(dataRows).toHaveLength(2);
    const byClinic = new Map(dataRows.map((r) => [r['Clinic Name'], r]));
    expect(byClinic.get('Active A')!['Amount (LCY)']).toBe(300);
    expect(byClinic.get('Active B')!['Amount (LCY)']).toBe(700);
    expect(byClinic.has('Dead')).toBe(false);
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

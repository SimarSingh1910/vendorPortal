import { Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import type { ClinicMonthExport, ExportRow } from './export.service';
import type { CorpExportRow } from './corp-export.service';

/**
 * INR amount format with Indian digit grouping (…,##,##,##0.00 — thousand/lakh/
 * crore) and 2 decimals, matching the app's en-IN money display. The conditional
 * sections switch the grouping as the magnitude crosses lakh (1e5) and crore (1e7),
 * which is how Excel renders true Indian grouping (a plain `#,##0.00` only ever
 * groups in threes).
 */
const INR_FMT = '[>=10000000]#,##,##,##0.00;[>=100000]#,##,##0.00;#,##0.00';

/**
 * The finance manager's unified column layout — EXACT headers and order, shared
 * by all three clinic Excel exports so each drops into their template without
 * renaming. Month sits right after G/L Account Name; Clinic Name sits right before
 * Acc. Location Code.
 *
 * GRAIN: one row per PARTICULAR. `Amount (LCY)` is that particular's derived value
 * (rate × quantity), and the head/vendor/clinic/month context repeats down a
 * line's particulars — so the column still sums to exactly the same grand total as
 * the old one-row-per-vendor-line sheet, over more rows.
 *
 * The original ten columns keep their exact headers AND positions. Particular /
 * Rate / Quantity are APPENDED at positions 11-13, so an existing template that
 * reads the first ten columns is unaffected.
 */
const COLUMNS: Array<{ key: string; header: string; width: number }> = [
  { key: 'glNo', header: 'G/L Account No.', width: 18 },
  { key: 'glName', header: 'G/L Account Name', width: 30 },
  { key: 'month', header: 'Month', width: 10 },
  { key: 'description', header: 'Description', width: 34 },
  { key: 'amount', header: 'Amount (LCY)', width: 16 },
  { key: 'vendor', header: 'Vendor Name', width: 24 },
  { key: 'clinic', header: 'Clinic Name', width: 26 },
  { key: 'accLocation', header: 'Acc. Location Code', width: 18 },
  { key: 'customer', header: 'Customer Code', width: 18 },
  { key: 'product', header: 'Product Code', width: 14 },
  // ── Appended for the particulars model; never reorder the ten above. ──
  { key: 'particular', header: 'Particular', width: 30 },
  { key: 'rate', header: 'Rate', width: 14 },
  { key: 'quantity', header: 'Quantity', width: 12 },
];

/** Rate carries 4 dp and quantity 3 dp — show them as entered, not as money. */
const RATE_FMT = '#,##0.0000';
const QTY_FMT = '#,##0.###';

/**
 * The corporate line layout — its OWN format (the clinic finance template does not
 * apply to departments). One row per corporate provision line. Department + Month
 * repeat on every row so a combined month-end sheet spanning departments stays
 * unambiguous. Vendor Name + Location are the SPOC's optional per-line free text.
 */
const CORP_COLUMNS: Array<{ key: string; header: string; width: number }> = [
  { key: 'department', header: 'Department', width: 26 },
  { key: 'month', header: 'Month', width: 10 },
  { key: 'expenseHead', header: 'Expense Head', width: 30 },
  { key: 'budgetCode', header: 'Budget Code', width: 16 },
  { key: 'vendor', header: 'Vendor Name', width: 24 },
  { key: 'location', header: 'Location', width: 24 },
  { key: 'amount', header: 'Amount (LCY)', width: 16 },
  { key: 'share', header: 'HCL Avitas Share', width: 18 },
  { key: 'description', header: 'Description', width: 34 },
];

function toBuffer(workbook: Workbook): Promise<Buffer> {
  return workbook.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer));
}

/**
 * Write the corporate line sheet: the CORP header on row 1, then one row per
 * corporate provision line. Amounts (and the frozen Sec 24 share) are real numbers
 * with the en-IN INR format; a null share/vendor/location/note is blank (never
 * "null"/"0").
 */
function writeCorpSheet(sheet: Worksheet, rows: CorpExportRow[]): void {
  sheet.columns = CORP_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.values = CORP_COLUMNS.map((c) => c.header);
  header.font = { bold: true };

  for (const r of rows) {
    const added = sheet.addRow({
      department: r.departmentName,
      month: r.month,
      expenseHead: r.expenseHead,
      budgetCode: r.budgetCode,
      vendor: r.vendorName ?? '',
      location: r.location ?? '',
      amount: Number(r.amount),
      share: r.hclAvitasShare === null ? '' : Number(r.hclAvitasShare),
      description: r.note ?? '',
    });
    added.getCell('amount').numFmt = INR_FMT;
    if (r.hclAvitasShare !== null) added.getCell('share').numFmt = INR_FMT;
  }
}

/**
 * Write the unified finance sheet: the exact header on row 1, then ONE ROW PER
 * PARTICULAR. Month and Clinic Name (plus the clinic codes) are written on EVERY
 * data row — never a title/section block — so consolidated / month-end sheets
 * spanning multiple clinics and months stay unambiguous, and the head/vendor
 * context likewise repeats down a vendor line's particulars.
 *
 * Amounts, rates and quantities are real numbers (spreadsheet-live, so finance can
 * re-total or re-derive rate × quantity in the sheet itself); a null
 * note/vendor/product/particular name is blank (never "null"/"0").
 */
function writeLineSheet(sheet: Worksheet, rows: ExportRow[]): void {
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.values = COLUMNS.map((c) => c.header);
  header.font = { bold: true };

  for (const r of rows) {
    const added = sheet.addRow({
      glNo: r.glAccountNo,
      glName: r.glAccountName,
      month: r.month,
      description: r.note ?? '',
      amount: Number(r.amount),
      vendor: r.vendorName ?? '',
      clinic: r.clinicName,
      accLocation: r.accLocationCode,
      customer: r.customerCode,
      product: r.productCode ?? '',
      particular: r.particularName ?? '',
      rate: Number(r.rate),
      quantity: Number(r.quantity),
    });
    added.getCell('amount').numFmt = INR_FMT;
    added.getCell('rate').numFmt = RATE_FMT;
    added.getCell('quantity').numFmt = QTY_FMT;
  }
}

/**
 * ExcelJS workbook builders for the FR-10 clinic exports. All three (individual /
 * consolidated / month-end) share ONE column layout (writeLineSheet), differing
 * only in which lines the service feeds them — so every clinic export matches the
 * finance manager's template exactly. Amounts are spreadsheet-live numbers.
 * (The Corporate export has its own separate format and is untouched.)
 */
@Injectable()
export class ExcelExportService {
  /** Single clinic, single month. */
  async clinicMonth(data: ClinicMonthExport): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    writeLineSheet(workbook.addWorksheet('Provisions'), data.rows);
    return toBuffer(workbook);
  }

  /** Consolidated across clinics for a month or range, after filters. */
  async consolidated(rows: ExportRow[]): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    writeLineSheet(workbook.addWorksheet('Provisions'), rows);
    return toBuffer(workbook);
  }

  /** Month-end: every active in-scope clinic's lines for the month. */
  async monthEnd(rows: ExportRow[]): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    writeLineSheet(workbook.addWorksheet('Provisions'), rows);
    return toBuffer(workbook);
  }

  /** Corporate individual: one department-month submission's lines. */
  async corpSubmission(rows: CorpExportRow[]): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    writeCorpSheet(workbook.addWorksheet('Provisions'), rows);
    return toBuffer(workbook);
  }

  /** Corporate combined month-end: every active in-scope department's lines for the month. */
  async corpMonthEnd(rows: CorpExportRow[]): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    writeCorpSheet(workbook.addWorksheet('Provisions'), rows);
    return toBuffer(workbook);
  }
}

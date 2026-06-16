import { Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import { SUBMISSION_STATUS_LABELS } from '@portal/shared';
import type { ClinicMonthExport, ExportRow, MonthEndExport } from './export.service';

const MONEY_FMT = '#,##0.00';

/** 'YYYY-MM' → 'July 2026'. */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toBuffer(workbook: Workbook): Promise<Buffer> {
  return workbook.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer));
}

function titleBlock(sheet: Worksheet, lines: string[]): void {
  lines.forEach((line, i) => {
    const row = sheet.getRow(i + 1);
    row.getCell(1).value = line;
    row.getCell(1).font = { bold: i === 0, size: i === 0 ? 14 : 11 };
  });
}

/**
 * ExcelJS workbook builders for the FR-10 exports. Amounts are written as real
 * numbers with an Indian-style 2dp number format so totals are spreadsheet-live
 * (not pre-formatted strings).
 */
@Injectable()
export class ExcelExportService {
  /** Single clinic, single month: Category / Head / Amount, with a total. */
  async clinicMonth(data: ClinicMonthExport): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    const sheet = workbook.addWorksheet('Clinic Month');

    titleBlock(sheet, [
      `Cost Provision — ${data.clinicName}`,
      `Month: ${monthLabel(data.month)}`,
      `Status: ${SUBMISSION_STATUS_LABELS[data.status]}`,
    ]);

    const headerRowIdx = 5;
    sheet.getRow(headerRowIdx).values = ['Category', 'Expense Head', 'Amount (INR)'];
    sheet.getRow(headerRowIdx).font = { bold: true };
    sheet.columns = [
      { key: 'category', width: 24 },
      { key: 'head', width: 34 },
      { key: 'amount', width: 18 },
    ];

    for (const row of data.rows) {
      const added = sheet.addRow({ category: row.category, head: row.expenseHeadName, amount: Number(row.amount) });
      added.getCell(3).numFmt = MONEY_FMT;
    }
    const totalRow = sheet.addRow({ category: '', head: 'Total', amount: Number(data.total) });
    totalRow.font = { bold: true };
    totalRow.getCell(3).numFmt = MONEY_FMT;

    return toBuffer(workbook);
  }

  /**
   * Consolidated detail + per-clinic summary for a month or month range, after
   * filters. Two sheets: granular rows and a clinic-total rollup.
   */
  async consolidated(rows: ExportRow[], filterNote: string): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';

    const detail = workbook.addWorksheet('Detail');
    detail.getRow(1).values = [filterNote];
    detail.getRow(1).font = { italic: true, color: { argb: 'FF666666' } };
    detail.getRow(3).values = ['Clinic', 'Month', 'Category', 'Expense Head', 'Amount (INR)', 'Status'];
    detail.getRow(3).font = { bold: true };
    detail.columns = [
      { key: 'clinic', width: 26 },
      { key: 'month', width: 12 },
      { key: 'category', width: 22 },
      { key: 'head', width: 32 },
      { key: 'amount', width: 16 },
      { key: 'status', width: 22 },
    ];
    for (const r of rows) {
      const added = detail.addRow({
        clinic: r.clinicName,
        month: r.month,
        category: r.category,
        head: r.expenseHeadName,
        amount: Number(r.amount),
        status: SUBMISSION_STATUS_LABELS[r.status],
      });
      added.getCell(5).numFmt = MONEY_FMT;
    }

    // Per-clinic rollup.
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.clinicName, (totals.get(r.clinicName) ?? 0) + Number(r.amount));
    const summary = workbook.addWorksheet('Summary');
    summary.getRow(1).values = ['Clinic', 'Total (INR)'];
    summary.getRow(1).font = { bold: true };
    summary.columns = [
      { key: 'clinic', width: 30 },
      { key: 'total', width: 18 },
    ];
    let grand = 0;
    for (const [clinic, total] of [...totals].sort((a, b) => b[1] - a[1])) {
      grand += total;
      const added = summary.addRow({ clinic, total });
      added.getCell(2).numFmt = MONEY_FMT;
    }
    const grandRow = summary.addRow({ clinic: 'Grand total', total: grand });
    grandRow.font = { bold: true };
    grandRow.getCell(2).numFmt = MONEY_FMT;

    return toBuffer(workbook);
  }

  /** Month-end provision report: head×clinic matrix with row/column totals. */
  async monthEnd(data: MonthEndExport): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    const sheet = workbook.addWorksheet('Month-End Report');

    titleBlock(sheet, [
      'Month-End Provision Report',
      `Month: ${monthLabel(data.month)}`,
      `Active clinics: ${data.clinics.length}`,
    ]);

    const headerIdx = 5;
    const header = ['Category', 'Expense Head', ...data.clinics.map((c) => c.name), 'Total'];
    sheet.getRow(headerIdx).values = header;
    sheet.getRow(headerIdx).font = { bold: true };
    sheet.columns = [
      { width: 22 },
      { width: 32 },
      ...data.clinics.map(() => ({ width: 18 })),
      { width: 18 },
    ];

    const clinicTotals = data.clinics.map(() => 0);
    for (const head of data.heads) {
      const cells = data.amounts[head.id] ?? {};
      let rowTotal = 0;
      const values: (string | number)[] = [head.category, head.name];
      data.clinics.forEach((c, i) => {
        const amt = cells[c.id] ? Number(cells[c.id]) : 0;
        values.push(amt);
        rowTotal += amt;
        clinicTotals[i] += amt;
      });
      values.push(rowTotal);
      const row = sheet.addRow(values);
      for (let i = 3; i <= header.length; i += 1) row.getCell(i).numFmt = MONEY_FMT;
    }

    const totalValues: (string | number)[] = ['', 'Total', ...clinicTotals, clinicTotals.reduce((a, b) => a + b, 0)];
    const totalRow = sheet.addRow(totalValues);
    totalRow.font = { bold: true };
    for (let i = 3; i <= header.length; i += 1) totalRow.getCell(i).numFmt = MONEY_FMT;

    // Status overview sheet.
    const status = workbook.addWorksheet('Clinic Status');
    status.getRow(1).values = ['Clinic', 'Status'];
    status.getRow(1).font = { bold: true };
    status.columns = [{ width: 30 }, { width: 24 }];
    for (const c of data.clinics) status.addRow([c.name, SUBMISSION_STATUS_LABELS[c.status]]);

    return toBuffer(workbook);
  }
}

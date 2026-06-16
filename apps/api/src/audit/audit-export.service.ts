import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { AuditLogView } from '@portal/shared';

/** Render audit rows (IST timestamps) as an .xlsx workbook buffer (ExcelJS). */
@Injectable()
export class AuditExportService {
  async toXlsx(rows: AuditLogView[]): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Cost Provision Portal';
    const sheet = workbook.addWorksheet('Audit Log');

    sheet.columns = [
      { header: 'Timestamp (IST)', key: 'timestamp', width: 22 },
      { header: 'Actor', key: 'actor', width: 22 },
      { header: 'Action', key: 'action', width: 28 },
      { header: 'Entity Type', key: 'entityType', width: 18 },
      { header: 'Entity Id', key: 'entityId', width: 26 },
      { header: 'Clinic', key: 'clinic', width: 22 },
      { header: 'IP', key: 'ip', width: 16 },
      { header: 'Old Value', key: 'oldValue', width: 40 },
      { header: 'New Value', key: 'newValue', width: 40 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow({
        timestamp: formatIST(row.performedAt),
        actor: row.performedByName ?? 'SYSTEM',
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        clinic: row.clinicName ?? '',
        ip: row.ipAddress ?? '',
        oldValue: stringifyValue(row.oldValue),
        newValue: stringifyValue(row.newValue),
      });
    }

    // ExcelJS returns an ArrayBuffer-like; normalize to a Node Buffer.
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }
}

function formatIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

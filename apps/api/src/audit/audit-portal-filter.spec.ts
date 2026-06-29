import { Test, type TestingModule } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import { PortalTab } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryService } from './audit-query.service';
import { AuditExportService } from './audit-export.service';
import { resetDb } from '../../test/reset';

/**
 * Audit-viewer PORTAL filter over the SINGLE append-only AuditLog (no new table /
 * triggers). Corporate = the CORP_* actions (enumerated + runtime CORP_SUBMISSION_*);
 * clinic = everything else (clinic actions + shared admin actions). Export shares
 * the same where clause. Viewing/filtering writes NO audit rows.
 */
describe('Audit viewer — clinic/corporate portal filter', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let query: AuditQueryService;
  let exporter: AuditExportService;

  // 4 clinic-portal actions (incl. the shared admin ones) + 3 corporate ones.
  const CLINIC_ACTIONS = ['SUBMISSION_SUBMIT', 'UNLOCK', 'USER_UPDATE', 'NOTIFICATION_CONFIG_CREATE'];
  const CORP_ACTIONS = ['CORP_DEPARTMENT_CREATE', 'CORP_SUBMISSION_SUBMIT', 'CORP_SEC24_PCT_SET'];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditQueryService, AuditExportService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    query = moduleRef.get(AuditQueryService);
    exporter = moduleRef.get(AuditExportService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    let i = 0;
    await prisma.auditLog.createMany({
      data: [...CLINIC_ACTIONS, ...CORP_ACTIONS].map((action) => ({
        entityType: 'Test',
        entityId: `e${(i += 1)}`,
        action,
        performedAt: new Date(`2026-04-0${i}T00:00:00Z`),
      })),
    });
  });

  it('CLINIC shows only non-CORP_ actions; CORPORATE shows only CORP_ actions; none → all', async () => {
    const clinic = await query.search({ portal: PortalTab.CLINIC });
    expect(clinic.total).toBe(CLINIC_ACTIONS.length);
    expect(clinic.items.every((r) => !r.action.startsWith('CORP_'))).toBe(true);

    const corp = await query.search({ portal: PortalTab.CORPORATE });
    expect(corp.total).toBe(CORP_ACTIONS.length);
    expect(corp.items.every((r) => r.action.startsWith('CORP_'))).toBe(true);

    const all = await query.search({});
    expect(all.total).toBe(CLINIC_ACTIONS.length + CORP_ACTIONS.length);
  });

  it('export respects the active portal filter', async () => {
    const rows = await query.searchForExport({ portal: PortalTab.CORPORATE });
    expect(rows).toHaveLength(CORP_ACTIONS.length);
    expect(rows.every((r) => r.action.startsWith('CORP_'))).toBe(true);

    const buffer = await exporter.toXlsx(rows);
    const wb = new Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('Audit Log')!;
    // Header row + one row per corporate action.
    expect(sheet.rowCount).toBe(CORP_ACTIONS.length + 1);
  });

  it('viewing / filtering / exporting writes NO new audit rows', async () => {
    const before = await prisma.auditLog.count();
    await query.search({ portal: PortalTab.CLINIC });
    await query.search({ portal: PortalTab.CORPORATE });
    await exporter.toXlsx(await query.searchForExport({ portal: PortalTab.CORPORATE }));
    expect(await prisma.auditLog.count()).toBe(before);
  });
});

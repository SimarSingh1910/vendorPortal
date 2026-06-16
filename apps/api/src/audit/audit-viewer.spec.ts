import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditExportService } from './audit-export.service';
import { resetDb } from '../../test/reset';

describe('Audit viewer + export (Step 9.2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let query: AuditQueryService;
  let exporter: AuditExportService;

  let seq = 0;
  const mkClinic = () => {
    seq += 1;
    return prisma.clinic.create({
      data: { name: `Clinic ${seq}`, location: 'L', corporateClient: 'X' },
    });
  };
  const mkUser = (role: UserRole) => {
    seq += 1;
    return prisma.user.create({
      data: { name: `User ${seq}`, email: `u${seq}@t.local`, passwordHash: 'x'.repeat(60), role },
    });
  };

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
  });

  /** Seed three rows across 2 clinics / 2 users / 2 actions / 3 dates. */
  async function seed() {
    const clinic1 = await mkClinic();
    const clinic2 = await mkClinic();
    const user1 = await mkUser(UserRole.FINANCE_ADMIN);
    const user2 = await mkUser(UserRole.CLINIC_MANAGER);

    await prisma.auditLog.createMany({
      data: [
        { entityType: 'MonthlySubmission', entityId: 's1', action: 'SUBMISSION_SUBMIT', clinicId: clinic1.id, performedById: user1.id, ipAddress: '10.0.0.1', performedAt: new Date('2026-01-01T00:00:00Z') },
        { entityType: 'MonthlySubmission', entityId: 's2', action: 'UNLOCK', clinicId: clinic1.id, performedById: user2.id, ipAddress: '10.0.0.2', performedAt: new Date('2026-02-01T00:00:00Z') },
        { entityType: 'MonthlySubmission', entityId: 's3', action: 'SUBMISSION_SUBMIT', clinicId: clinic2.id, performedById: user1.id, ipAddress: '10.0.0.3', performedAt: new Date('2026-03-01T00:00:00Z') },
      ],
    });
    return { clinic1, clinic2, user1, user2 };
  }

  it('filters by clinic, user, action and date range; newest first; paginates', async () => {
    const { clinic1, user1 } = await seed();

    expect((await query.search({ clinicId: clinic1.id })).total).toBe(2);
    expect((await query.search({ performedById: user1.id })).total).toBe(2);
    expect((await query.search({ action: 'SUBMISSION_SUBMIT' })).total).toBe(2);

    const ranged = await query.search({ from: '2026-02-15T00:00:00Z', to: '2026-03-15T00:00:00Z' });
    expect(ranged.total).toBe(1);
    expect(ranged.items[0].entityId).toBe('s3');

    // Newest first + clinic name + actor name resolved.
    const all = await query.search({});
    expect(all.items.map((r) => r.entityId)).toEqual(['s3', 's2', 's1']);
    expect(all.items[0].clinicName).toBeTruthy();
    expect(all.items[0].performedByName).toBeTruthy();

    // Pagination.
    const p1 = await query.search({ page: 1, pageSize: 2 });
    expect(p1.items.map((r) => r.entityId)).toEqual(['s3', 's2']);
    expect(p1.total).toBe(3);
    const p2 = await query.search({ page: 2, pageSize: 2 });
    expect(p2.items.map((r) => r.entityId)).toEqual(['s1']);
  });

  it('exports the filtered set as a valid .xlsx', async () => {
    await seed();
    const rows = await query.searchForExport({ action: 'SUBMISSION_SUBMIT' });
    expect(rows).toHaveLength(2);

    const buffer = await exporter.toXlsx(rows);
    expect(buffer.length).toBeGreaterThan(0);

    // Re-open it to prove it's a real workbook with header + 2 data rows.
    const wb = new Workbook();
    // @types/node 22's generic Buffer vs ExcelJS's Buffer param — cast for the test.
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('Audit Log');
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3);
    expect(sheet!.getRow(1).getCell(1).value).toBe('Timestamp (IST)');
  });

  it('RolesGuard blocks a non-admin on the audit endpoints (403) and allows FINANCE_ADMIN', async () => {
    const guard = new RolesGuard(new Reflector());
    const ctxFor = (role: UserRole): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        getHandler: () => AuditController.prototype.search,
        getClass: () => AuditController,
      }) as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctxFor(UserRole.FINANCE_VIEWER))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctxFor(UserRole.CLINIC_MANAGER))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctxFor(UserRole.FINANCE_ADMIN))).toBe(true);
  });
});

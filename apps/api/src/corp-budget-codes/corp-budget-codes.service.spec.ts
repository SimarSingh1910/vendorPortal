import { Test, type TestingModule } from '@nestjs/testing';
import type { CorpDepartment } from '@prisma/client';
import { AuditAction } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditQueryService } from '../audit/audit-query.service';
import { CorpBudgetCodesService } from './corp-budget-codes.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step C1.2 — per-department budget-code master CRUD. Finance-Admin manages
 * codes (code + optional description, is_active) per department; only that
 * department's ACTIVE codes are returned for its dropdown (BR-C02); codes are
 * unique within a department; deactivation retains history (BR-C10); each
 * mutation writes one audit row; reads never audit.
 */
describe('CorpBudgetCodesService (Step C1.2)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let codes: CorpBudgetCodesService;
  let auditQuery: AuditQueryService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, AuditQueryService, CorpBudgetCodesService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    codes = moduleRef.get(CorpBudgetCodesService);
    auditQuery = moduleRef.get(AuditQueryService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  let deptA: CorpDepartment;
  let deptB: CorpDepartment;
  beforeEach(async () => {
    await resetDb(prisma);
    deptA = await prisma.corpDepartment.create({ data: { name: 'Dept A' } });
    deptB = await prisma.corpDepartment.create({ data: { name: 'Dept B' } });
  });

  const auditFor = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityType: 'CorpBudgetCode', entityId } });

  // ── create ──────────────────────────────────────────────────────────────────

  it('creates a code (with optional description) and writes one CORP_BUDGET_CODE_CREATE row', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-C01', description: 'Salaries pool' });
    expect(code.departmentId).toBe(deptA.id);
    expect(code.code).toBe('BR-C01');
    expect(code.description).toBe('Salaries pool');
    expect(code.isActive).toBe(true);

    const rows = await auditFor(code.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.CORP_BUDGET_CODE_CREATE);
  });

  it('allows a missing description (null)', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-C02' });
    expect(code.description).toBeNull();
  });

  it('create under an unknown department is 404', async () => {
    await expectStatus(codes.create('nope', { code: 'BR-C01' }), 404);
  });

  // ── uniqueness within a department ────────────────────────────────────────────

  it('rejects a duplicate code within the same department (409) but allows it in another (BR-C01)', async () => {
    await codes.create(deptA.id, { code: 'BR-C01' });
    await expectStatus(codes.create(deptA.id, { code: 'BR-C01' }), 409);

    // The SAME code string is independent per department.
    const inB = await codes.create(deptB.id, { code: 'BR-C01' });
    expect(inB.departmentId).toBe(deptB.id);
  });

  // ── dropdown contract: only this dept's ACTIVE codes (BR-C02) ──────────────────

  it("list('active') returns only this department's active codes — never inactive, never another dept's", async () => {
    const a1 = await codes.create(deptA.id, { code: 'BR-A1' });
    const a2 = await codes.create(deptA.id, { code: 'BR-A2' });
    await codes.create(deptB.id, { code: 'BR-B1' });
    await codes.setActive(deptA.id, a2.id, false); // deactivate one of A's

    const dropdown = await codes.list(deptA.id, 'active');
    expect(dropdown.map((c) => c.id)).toEqual([a1.id]);

    expect((await codes.list(deptA.id, 'inactive')).map((c) => c.id)).toEqual([a2.id]);
    expect((await codes.list(deptA.id, 'all')).map((c) => c.code)).toEqual(['BR-A1', 'BR-A2']);
  });

  it('get/update/setActive for a code in another department is 404 (dept-scoped)', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-A1' });
    await expectStatus(codes.get(deptB.id, code.id), 404);
    await expectStatus(codes.update(deptB.id, code.id, { description: 'hijack' }), 404);
    await expectStatus(codes.setActive(deptB.id, code.id, false), 404);
  });

  // ── update ──────────────────────────────────────────────────────────────────

  it('edits code/description and records old→new in one CORP_BUDGET_CODE_UPDATE row', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-OLD', description: 'old' });
    const updated = await codes.update(deptA.id, code.id, { code: 'BR-NEW', description: 'new' });
    expect(updated.code).toBe('BR-NEW');
    expect(updated.description).toBe('new');

    const rows = (await auditFor(code.id)).filter(
      (r) => r.action === AuditAction.CORP_BUDGET_CODE_UPDATE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ code: 'BR-OLD', description: 'old' });
    expect(rows[0].newValue).toMatchObject({ code: 'BR-NEW', description: 'new' });
  });

  it('rejects renaming a code onto an existing code in the same department (409)', async () => {
    await codes.create(deptA.id, { code: 'BR-A1' });
    const a2 = await codes.create(deptA.id, { code: 'BR-A2' });
    await expectStatus(codes.update(deptA.id, a2.id, { code: 'BR-A1' }), 409);
  });

  // ── deactivate / activate retains history (BR-C10) ────────────────────────────

  it('deactivation flips the flag, keeps the row, and audits both directions', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-A1' });

    const off = await codes.setActive(deptA.id, code.id, false);
    expect(off.isActive).toBe(false);
    expect(await prisma.corpBudgetCode.findUnique({ where: { id: code.id } })).not.toBeNull();

    const on = await codes.setActive(deptA.id, code.id, true);
    expect(on.isActive).toBe(true);

    const setActiveRows = (await auditFor(code.id)).filter(
      (r) => r.action === AuditAction.CORP_BUDGET_CODE_SET_ACTIVE,
    );
    expect(setActiveRows).toHaveLength(2);
  });

  // ── audit filter ──────────────────────────────────────────────────────────────

  it('every mutating action surfaces in the audit filter (distinctActions)', async () => {
    const code = await codes.create(deptA.id, { code: 'BR-FILTER' });
    await codes.update(deptA.id, code.id, { description: 'x' });
    await codes.setActive(deptA.id, code.id, false);

    const actions = await auditQuery.distinctActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CORP_BUDGET_CODE_CREATE,
        AuditAction.CORP_BUDGET_CODE_UPDATE,
        AuditAction.CORP_BUDGET_CODE_SET_ACTIVE,
      ]),
    );
  });
});

import { Test, type TestingModule } from '@nestjs/testing';
import type { CorpDepartment } from '@prisma/client';
import { AuditAction } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditQueryService } from '../audit/audit-query.service';
import { CorpExpenseHeadsService } from './corp-expense-heads.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step C1.1 — corporate expense-head master CRUD. Heads are scoped to ONE
 * department and are NOT shared across departments (BR-C09). Deactivation
 * retains history (BR-C10); each mutation writes one audit row; reads never
 * audit. Cross-department access resolves to 404.
 */
describe('CorpExpenseHeadsService (Step C1.1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let heads: CorpExpenseHeadsService;
  let auditQuery: AuditQueryService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, AuditQueryService, CorpExpenseHeadsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    heads = moduleRef.get(CorpExpenseHeadsService);
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
    prisma.auditLog.findMany({ where: { entityType: 'CorpExpenseHead', entityId } });

  // ── create + per-department scoping (BR-C09) ─────────────────────────────────

  it('creates a head under a department and writes one CORP_EXPENSE_HEAD_CREATE row', async () => {
    const head = await heads.create(deptA.id, { name: 'Salaries' });
    expect(head.departmentId).toBe(deptA.id);
    expect(head.isActive).toBe(true);

    const rows = await auditFor(head.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.CORP_EXPENSE_HEAD_CREATE);
  });

  it('heads are NOT shared across departments: the same name lives independently in each (BR-C09)', async () => {
    const a = await heads.create(deptA.id, { name: 'Travel' });
    const b = await heads.create(deptB.id, { name: 'Travel' });
    expect(a.id).not.toBe(b.id);

    expect((await heads.list(deptA.id, 'all')).map((h) => h.id)).toEqual([a.id]);
    expect((await heads.list(deptB.id, 'all')).map((h) => h.id)).toEqual([b.id]);
  });

  it('create under an unknown department is 404', async () => {
    await expectStatus(heads.create('nope', { name: 'X' }), 404);
  });

  // ── read ──────────────────────────────────────────────────────────────────────

  it('list filters by status within the department', async () => {
    const active = await heads.create(deptA.id, { name: 'Active head' });
    const inactive = await heads.create(deptA.id, { name: 'Inactive head' });
    await heads.setActive(deptA.id, inactive.id, false);

    expect((await heads.list(deptA.id, 'active')).map((h) => h.id)).toEqual([active.id]);
    expect((await heads.list(deptA.id, 'inactive')).map((h) => h.id)).toEqual([inactive.id]);
  });

  it('get/update/setActive for a head in another department is 404 (dept-scoped)', async () => {
    const head = await heads.create(deptA.id, { name: 'A only' });
    await expectStatus(heads.get(deptB.id, head.id), 404);
    await expectStatus(heads.update(deptB.id, head.id, { name: 'hijack' }), 404);
    await expectStatus(heads.setActive(deptB.id, head.id, false), 404);
  });

  // ── update ──────────────────────────────────────────────────────────────────

  it('renames a head and records old→new in one CORP_EXPENSE_HEAD_UPDATE row', async () => {
    const head = await heads.create(deptA.id, { name: 'Old' });
    const updated = await heads.update(deptA.id, head.id, { name: 'New' });
    expect(updated.name).toBe('New');

    const rows = (await auditFor(head.id)).filter(
      (r) => r.action === AuditAction.CORP_EXPENSE_HEAD_UPDATE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ name: 'Old' });
    expect(rows[0].newValue).toMatchObject({ name: 'New' });
  });

  // ── deactivate / activate retains history (BR-C10) ────────────────────────────

  it('deactivation flips the flag, keeps the row, and audits both directions', async () => {
    const head = await heads.create(deptA.id, { name: 'Rent' });

    const off = await heads.setActive(deptA.id, head.id, false);
    expect(off.isActive).toBe(false);
    // Never deleted — the row survives.
    expect(await prisma.corpExpenseHead.findUnique({ where: { id: head.id } })).not.toBeNull();

    const on = await heads.setActive(deptA.id, head.id, true);
    expect(on.isActive).toBe(true);

    const setActiveRows = (await auditFor(head.id)).filter(
      (r) => r.action === AuditAction.CORP_EXPENSE_HEAD_SET_ACTIVE,
    );
    expect(setActiveRows).toHaveLength(2);
  });

  // ── audit filter ──────────────────────────────────────────────────────────────

  it('every mutating action surfaces in the audit filter (distinctActions)', async () => {
    const head = await heads.create(deptA.id, { name: 'Filter head' });
    await heads.update(deptA.id, head.id, { name: 'Filter head 2' });
    await heads.setActive(deptA.id, head.id, false);

    const actions = await auditQuery.distinctActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CORP_EXPENSE_HEAD_CREATE,
        AuditAction.CORP_EXPENSE_HEAD_UPDATE,
        AuditAction.CORP_EXPENSE_HEAD_SET_ACTIVE,
      ]),
    );
  });
});

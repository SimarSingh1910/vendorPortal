import { Test, type TestingModule } from '@nestjs/testing';
import { AuditAction, CorpDepartmentType } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditQueryService } from '../audit/audit-query.service';
import { CorpDepartmentsService } from './corp-departments.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step C1.1 — corporate department master CRUD. Finance-Admin manages
 * departments (add/edit/deactivate, with a type); deactivation retains history
 * (BR-C10); every mutation writes exactly one audit row whose action surfaces in
 * the audit filter; reads never audit.
 */
describe('CorpDepartmentsService (Step C1.1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let departments: CorpDepartmentsService;
  let auditQuery: AuditQueryService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, AuditQueryService, CorpDepartmentsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    departments = moduleRef.get(CorpDepartmentsService);
    auditQuery = moduleRef.get(AuditQueryService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const auditFor = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityType: 'CorpDepartment', entityId } });

  // ── create ──────────────────────────────────────────────────────────────────

  it('creates a department with a type and writes one CORP_DEPARTMENT_CREATE row', async () => {
    const dept = await departments.create({
      name: 'Finance HQ',
      type: CorpDepartmentType.SHARED_COST_POOL,
    });
    expect(dept.name).toBe('Finance HQ');
    expect(dept.type).toBe(CorpDepartmentType.SHARED_COST_POOL);
    expect(dept.isActive).toBe(true);

    const rows = await auditFor(dept.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.CORP_DEPARTMENT_CREATE);
  });

  it('defaults type to STANDARD when omitted', async () => {
    const dept = await departments.create({ name: 'Procurement' });
    expect(dept.type).toBe(CorpDepartmentType.STANDARD);
  });

  // ── read (no audit) ───────────────────────────────────────────────────────────

  it('list filters by status and never audits', async () => {
    const active = await departments.create({ name: 'A' });
    const inactive = await departments.create({ name: 'B' });
    await departments.setActive(inactive.id, false);

    expect((await departments.list('active')).map((d) => d.id)).toEqual([active.id]);
    expect((await departments.list('inactive')).map((d) => d.id)).toEqual([inactive.id]);
    expect((await departments.list('all')).map((d) => d.name)).toEqual(['A', 'B']);

    // A list read adds no audit rows beyond the create + setActive above.
    const total = await prisma.auditLog.count();
    expect(total).toBe(3); // create A, create B, setActive B
  });

  it('get throws 404 for an unknown id', async () => {
    await expectStatus(departments.get('does-not-exist'), 404);
  });

  // ── update ──────────────────────────────────────────────────────────────────

  it('edits name/type and records old→new in one CORP_DEPARTMENT_UPDATE row', async () => {
    const dept = await departments.create({ name: 'Old', type: CorpDepartmentType.STANDARD });
    const updated = await departments.update(dept.id, {
      name: 'New',
      type: CorpDepartmentType.INTERNAL_BU,
    });
    expect(updated.name).toBe('New');
    expect(updated.type).toBe(CorpDepartmentType.INTERNAL_BU);

    const rows = (await auditFor(dept.id)).filter(
      (r) => r.action === AuditAction.CORP_DEPARTMENT_UPDATE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ name: 'Old', type: CorpDepartmentType.STANDARD });
    expect(rows[0].newValue).toMatchObject({ name: 'New', type: CorpDepartmentType.INTERNAL_BU });
  });

  // ── deactivate / activate retains history ────────────────────────────────────

  it('deactivation flips the flag, keeps the row + its child history, and audits', async () => {
    const dept = await departments.create({ name: 'Legacy BU', type: CorpDepartmentType.INTERNAL_BU });
    // Child history that must survive deactivation.
    const head = await prisma.corpExpenseHead.create({
      data: { departmentId: dept.id, name: 'Salaries' },
    });
    const code = await prisma.corpBudgetCode.create({
      data: { departmentId: dept.id, code: 'BR-C01' },
    });

    const deactivated = await departments.setActive(dept.id, false);
    expect(deactivated.isActive).toBe(false);

    // The department and ALL its history are still present (never deleted).
    expect(await prisma.corpDepartment.findUnique({ where: { id: dept.id } })).not.toBeNull();
    expect(await prisma.corpExpenseHead.findUnique({ where: { id: head.id } })).not.toBeNull();
    expect(await prisma.corpBudgetCode.findUnique({ where: { id: code.id } })).not.toBeNull();

    // Reactivation works and audits again.
    const reactivated = await departments.setActive(dept.id, true);
    expect(reactivated.isActive).toBe(true);

    const setActiveRows = (await auditFor(dept.id)).filter(
      (r) => r.action === AuditAction.CORP_DEPARTMENT_SET_ACTIVE,
    );
    expect(setActiveRows).toHaveLength(2);
  });

  // ── audit filter ──────────────────────────────────────────────────────────────

  it('every mutating action surfaces in the audit filter (distinctActions)', async () => {
    const dept = await departments.create({ name: 'Filter Co' });
    await departments.update(dept.id, { name: 'Filter Co 2' });
    await departments.setActive(dept.id, false);

    const actions = await auditQuery.distinctActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CORP_DEPARTMENT_CREATE,
        AuditAction.CORP_DEPARTMENT_UPDATE,
        AuditAction.CORP_DEPARTMENT_SET_ACTIVE,
      ]),
    );
  });
});

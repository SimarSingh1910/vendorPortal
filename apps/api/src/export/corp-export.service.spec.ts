import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { CorpExportService } from './corp-export.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

const MONTH = '2026-07';

/**
 * Corporate Excel export data feed — the granular per-line rows behind the
 * individual (department-month) and combined month-end workbooks. Confirms the
 * per-line Vendor Name + Location land in the export rows and that access is
 * department-scoped.
 */
describe('CorpExportService (corporate Excel export data)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let exporter: CorpExportService;
  let cycle: CorpCycleService;
  let fx: CorpFixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        CorpExpenseHeadsService,
        CorpCycleService,
        CorpDepartmentScopeService,
        CorpExportService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    exporter = moduleRef.get(CorpExportService);
    cycle = moduleRef.get(CorpCycleService);
    fx = makeCorpFixtures(prisma, cycle);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function scenario() {
    const dept = await fx.makeDept({ name: 'Human Resources' });
    await fx.makeHead(dept.id, { name: 'Salaries' });
    await fx.makeHead(dept.id, { name: 'Travel' });
    const code = await fx.makeBudgetCode(dept.id, { code: 'BR-C01' });
    const spoc = await fx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const fm = await fx.makeUser(UserRole.CORP_FINANCE_MANAGER);
    const { submission } = await fx.openCycle(dept.id, MONTH);
    const snaps = await prisma.corpSubmissionExpenseHeadSnapshot.findMany({
      where: { submissionId: submission.id },
      orderBy: { expenseHeadNameAtSnapshot: 'asc' },
    });
    // Salaries: with vendor + location; Travel: neither (blank).
    await prisma.corpProvisionEntry.create({
      data: {
        submissionId: submission.id,
        snapshotId: snaps[0].id,
        budgetCodeId: code.id,
        amount: 100,
        vendorName: 'Acme Corp',
        location: 'Pune HQ',
        enteredById: spoc.id,
        lastModifiedById: spoc.id,
      },
    });
    await prisma.corpProvisionEntry.create({
      data: {
        submissionId: submission.id,
        snapshotId: snaps[1].id,
        budgetCodeId: code.id,
        amount: 200,
        enteredById: spoc.id,
        lastModifiedById: spoc.id,
      },
    });
    return { dept, spoc, fm, submissionId: submission.id };
  }

  it('individual export includes each line’s vendor name + location (blank → null)', async () => {
    const { fm, submissionId } = await scenario();
    const out = await exporter.submissionExport(fm, submissionId);

    expect(out.departmentName).toBe('Human Resources');
    expect(out.month).toBe(MONTH);
    expect(out.rows).toHaveLength(2);

    const salaries = out.rows.find((r) => r.expenseHead === 'Salaries')!;
    expect(salaries.vendorName).toBe('Acme Corp');
    expect(salaries.location).toBe('Pune HQ');
    expect(salaries.amount).toBe('100.00');
    expect(salaries.budgetCode).toBe('BR-C01');

    const travel = out.rows.find((r) => r.expenseHead === 'Travel')!;
    expect(travel.vendorName).toBeNull();
    expect(travel.location).toBeNull();
  });

  it('combined month-end export carries vendor name + location across departments', async () => {
    const { fm } = await scenario();
    const rows = await exporter.monthEnd(fm, MONTH);
    const salaries = rows.find((r) => r.expenseHead === 'Salaries')!;
    expect(salaries.departmentName).toBe('Human Resources');
    expect(salaries.vendorName).toBe('Acme Corp');
    expect(salaries.location).toBe('Pune HQ');
  });

  it('a SPOC of another department cannot export this submission (403)', async () => {
    const { submissionId } = await scenario();
    const otherDept = await fx.makeDept();
    const otherSpoc = await fx.makeUser(UserRole.DEPT_SPOC, [otherDept.id]);
    await expectStatus(exporter.submissionExport(otherSpoc, submissionId), 403);
  });
});

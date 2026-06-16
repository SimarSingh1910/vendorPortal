import { Test, type TestingModule } from '@nestjs/testing';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { ClinicsService } from '../clinics/clinics.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { ProvisionEntryService } from '../submissions/provision-entry.service';
import { AuditService } from './audit.service';
import { runWithRequestContext } from './request-context';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-07';

/** Minimal AuthService stub so UsersService can be exercised in isolation. */
const authStub = {
  hashPassword: async () => 'x'.repeat(60),
  invalidateUserSessions: async () => undefined,
};

describe('Audit logging (Step 9.1 — append-only, unified write path)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let entries: ProvisionEntryService;
  let clinics: ClinicsService;
  let users: UsersService;
  let audit: AuditService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        ClinicsService,
        UsersService,
        CycleService,
        WorkflowService,
        SubmissionsService,
        ProvisionEntryService,
        AuditService,
        { provide: AuthService, useValue: authStub },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    entries = moduleRef.get(ProvisionEntryService);
    clinics = moduleRef.get(ClinicsService);
    users = moduleRef.get(UsersService);
    audit = moduleRef.get(AuditService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  /** Run `fn` as `userId` from a given IP (mimics the HTTP request context). */
  const asUser = <T>(userId: string, fn: () => Promise<T>, ip = '192.0.2.10'): Promise<T> =>
    runWithRequestContext({ user: { id: userId }, ip }, fn);

  const rowsFor = (action: string, entityId?: string) =>
    prisma.auditLog.findMany({ where: { action, ...(entityId ? { entityId } : {}) } });

  it('writes exactly one correct row per workflow action; cycle-open is a SYSTEM action', async () => {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);

    // Cycle-open WITHOUT a request → SYSTEM actor (null) + null IP.
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    const openRows = await rowsFor('CYCLE_OPEN', submission.id);
    expect(openRows).toHaveLength(1);
    expect(openRows[0].performedById).toBeNull();
    expect(openRows[0].ipAddress).toBeNull();
    expect(openRows[0].clinicId).toBe(clinic.id);

    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const manager = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id])).user;
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    const snap = await prisma.submissionExpenseHeadSnapshot.findFirstOrThrow({
      where: { submissionId: submission.id },
    });

    // save (SPOC)
    await asUser(spoc.id, () =>
      entries.saveEntries(submission.id, spoc, [{ snapshotId: snap.id, amount: 100 }]),
    );
    const saveRows = await rowsFor('PROVISION_SAVE', submission.id);
    expect(saveRows).toHaveLength(1);
    expect(saveRows[0].performedById).toBe(spoc.id);
    expect(saveRows[0].ipAddress).toBe('192.0.2.10');
    expect(saveRows[0].clinicId).toBe(clinic.id);

    // submit (SPOC) — clinic-scoped row carries clinicId.
    await asUser(spoc.id, () => workflow.submit(submission.id, spoc));
    const submitRows = await rowsFor('SUBMISSION_SUBMIT', submission.id);
    expect(submitRows).toHaveLength(1);
    expect(submitRows[0].clinicId).toBe(clinic.id);

    // manager review + approve
    await asUser(manager.id, () => workflow.managerOpenReview(submission.id, manager));
    await asUser(manager.id, () => workflow.managerApprove(submission.id, manager));
    const approveRows = await rowsFor('SUBMISSION_MANAGER_APPROVE', submission.id);
    expect(approveRows).toHaveLength(1);
    expect(approveRows[0].performedById).toBe(manager.id);
    expect(approveRows[0].clinicId).toBe(clinic.id);

    // finance open + send back
    await asUser(admin.id, () => workflow.financeOpenReview(submission.id, admin));
    await asUser(admin.id, () => workflow.financeSendBack(submission.id, admin, 'please fix'));
    const sendBackRows = await rowsFor('SUBMISSION_FINANCE_SEND_BACK', submission.id);
    expect(sendBackRows).toHaveLength(1);
    expect(sendBackRows[0].clinicId).toBe(clinic.id);

    // SAVE_DRAFT (triggered by the save above) must NOT be audited (no double row).
    expect(await rowsFor('SUBMISSION_SAVE_DRAFT', submission.id)).toHaveLength(0);

    // Every clinic-scoped row must carry the clinicId (the filter 9.2 rides on).
    const clinicScoped = await prisma.auditLog.findMany({
      where: { entityId: submission.id },
      select: { clinicId: true },
    });
    expect(clinicScoped.length).toBeGreaterThan(0);
    expect(clinicScoped.every((r) => r.clinicId === clinic.id)).toBe(true);
  });

  it('audits a master edit and a user edit', async () => {
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    // Master edit (clinic update).
    const clinic = await clinics.create({
      name: 'Alpha',
      location: 'Pune',
      corporateClient: 'Acme',
    });
    await asUser(admin.id, () =>
      clinics.update(clinic.id, { name: 'Alpha 2', location: 'Pune', corporateClient: 'Acme' }),
    );
    const clinicRows = await rowsFor('CLINIC_UPDATE', clinic.id);
    expect(clinicRows).toHaveLength(1);
    expect(clinicRows[0].clinicId).toBe(clinic.id);
    expect(clinicRows[0].performedById).toBe(admin.id);

    // User edit (role change).
    const target = await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    await asUser(admin.id, () =>
      users.update(target.dbUser.id, { role: UserRole.CLINIC_VIEWER }, admin.id),
    );
    const userRows = await rowsFor('USER_UPDATE', target.dbUser.id);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].performedById).toBe(admin.id);
  });

  it('append-only: a direct UPDATE or DELETE on an auditlog row throws', async () => {
    const admin = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    await asUser(admin.id, () =>
      audit.record({ action: 'TEST_ROW', entityType: 'X', entityId: 'x1' }),
    );
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'TEST_ROW' } });

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'MUTATED' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();

    // The row is intact and untouched.
    const still = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(still.action).toBe('TEST_ROW');
  });
});

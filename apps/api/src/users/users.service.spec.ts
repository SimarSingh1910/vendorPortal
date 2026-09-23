// Auth secrets must exist before the module (ConfigService) is built.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.BCRYPT_ROUNDS = '4';

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CommentAction, type Clinic } from '@prisma/client';
import { AuditAction, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { UsersService } from './users.service';
import type { RequestUser } from '../auth/request-user';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Clinic-role users (Manager / SPOC / Viewer) must be assigned to AT LEAST ONE
 * clinic (one or more); finance roles carry none. Validation lives in
 * UsersService (cross-field role↔clinic), with the scope reads confirmed via
 * ClinicScopeService.
 */
describe('UsersService — one or more clinics per clinic-role user', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let scope: ClinicScopeService;
  let seq = 0;
  const email = () => `u${(seq += 1)}@test.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
      providers: [PrismaService, AuthService, AuditService, ClinicScopeService, UsersService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UsersService);
    scope = moduleRef.get(ClinicScopeService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  let clinicA: Clinic;
  let clinicB: Clinic;
  beforeEach(async () => {
    await resetDb(prisma);
    clinicA = await prisma.clinic.create({
      data: {
        name: 'Clinic A',
        accLocationCode: 'ACC-A',
        customerCode: 'CUST-A',
        customerName: 'Customer A',
        isActive: true,
      },
    });
    clinicB = await prisma.clinic.create({
      data: {
        name: 'Clinic B',
        accLocationCode: 'ACC-B',
        customerCode: 'CUST-B',
        customerName: 'Customer B',
        isActive: true,
      },
    });
  });

  const base = { name: 'X', password: 'Secret@123' };

  // ── create ───────────────────────────────────────────────────────────────

  it('rejects a clinic-role user with NO clinic (400)', async () => {
    await expectStatus(
      users.create({ ...base, email: email(), role: UserRole.CLINIC_SPOC, clinicIds: [] }),
      400,
    );
  });

  it('accepts a clinic-role user with MULTIPLE clinics (de-duplicated)', async () => {
    const manager = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_MANAGER,
      clinicIds: [clinicA.id, clinicB.id, clinicA.id],
    });
    expect([...manager.clinicIds].sort()).toEqual([clinicA.id, clinicB.id].sort());
  });

  it('rejects a clinic assigned to a finance-role user (400)', async () => {
    await expectStatus(
      users.create({
        ...base,
        email: email(),
        role: UserRole.FINANCE_MANAGER,
        clinicIds: [clinicA.id],
      }),
      400,
    );
  });

  it('accepts a clinic-role user with exactly one clinic; finance with none', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });
    expect(spoc.clinicIds).toEqual([clinicA.id]);

    const finance = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
    });
    expect(finance.clinicIds).toEqual([]);
  });

  // ── update ───────────────────────────────────────────────────────────────

  it('widens a one-clinic user to several on edit, and rejects clearing all clinics (400)', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });

    const widened = await users.update(spoc.id, { clinicIds: [clinicA.id, clinicB.id] }, 'requester');
    expect([...widened.clinicIds].sort()).toEqual([clinicA.id, clinicB.id].sort());

    // A clinic-role user may not be left with zero clinics.
    await expectStatus(users.update(spoc.id, { clinicIds: [] }, 'requester'), 400);
  });

  it('promoting a clinic user to finance clears the clinic; an explicit clinic is rejected', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });
    // No clinic supplied → role flip to finance clears the assignment.
    const promoted = await users.update(spoc.id, { role: UserRole.FINANCE_MANAGER }, 'requester');
    expect(promoted.role).toBe(UserRole.FINANCE_MANAGER);
    expect(promoted.clinicIds).toEqual([]);

    // Supplying a clinic for a finance role is rejected outright.
    const spoc2 = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicB.id],
    });
    await expectStatus(
      users.update(spoc2.id, { role: UserRole.FINANCE_ADMIN, clinicIds: [clinicB.id] }, 'requester'),
      400,
    );
  });

  // ── email edit ─────────────────────────────────────────────────────────────

  const tokenVersion = async (id: string): Promise<number> =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).tokenVersion;

  it('changes the email, invalidates sessions and audits old→new', async () => {
    const user = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
    });
    const before = await tokenVersion(user.id);
    const next = email();

    const updated = await users.update(user.id, { email: next }, 'requester');
    expect(updated.email).toBe(next);
    expect((await users.get(user.id)).email).toBe(next);
    // The login identity moved, so outstanding sessions must die.
    expect(await tokenVersion(user.id)).toBe(before + 1);

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_UPDATE, entityId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ email: user.email });
    expect(rows[0].newValue).toMatchObject({ email: next });
  });

  it('rejects an email already in use (409); re-sending the current one is a no-op', async () => {
    const taken = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
    });
    const user = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
    });

    await expectStatus(users.update(user.id, { email: taken.email }, 'requester'), 409);
    await expect(users.update(user.id, { email: taken.email }, 'requester')).rejects.toThrow(
      'Email already in use',
    );

    // Unchanged email: must not 409 against the user's own row, and must not
    // needlessly end their session.
    const before = await tokenVersion(user.id);
    const unchanged = await users.update(user.id, { email: user.email }, 'requester');
    expect(unchanged.email).toBe(user.email);
    expect(await tokenVersion(user.id)).toBe(before);

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_UPDATE, entityId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).not.toHaveProperty('email');
    expect(rows[0].newValue).not.toHaveProperty('email');

    // Re-casing: the email column collates utf8mb4_unicode_ci, so the uniqueness
    // lookup finds the user's OWN row — it must not 409 against a nonexistent
    // third account.
    const shouted = user.email.toUpperCase();
    const recased = await users.update(user.id, { email: shouted }, 'requester');
    expect(recased.email).toBe(shouted);
  });

  // ── safe delete ────────────────────────────────────────────────────────────
  // A user is hard-deleted ONLY when they appear nowhere in history. Every
  // blocker is counted in the service because several of the FKs are
  // ON DELETE SET NULL — the DB would silently blank the actor, not refuse.

  it('removes a user with no history, cascades assignments and audits USER_DELETE', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });

    const removed = await users.remove(spoc.id, 'admin');
    expect(removed.id).toBe(spoc.id);
    expect(await prisma.user.findUnique({ where: { id: spoc.id } })).toBeNull();
    expect(await prisma.userClinicAssignment.count({ where: { userId: spoc.id } })).toBe(0);

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_DELETE, entityId: spoc.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({
      email: spoc.email,
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });
  });

  it('refuses (409) a user who appears in submission history, naming the categories', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });
    const head = await prisma.expenseHead.create({
      data: { glAccountName: 'Rent', glAccountNo: 'GL-1' },
    });
    const submission = await prisma.monthlySubmission.create({
      data: { clinicId: clinicA.id, month: '2026-01' },
    });
    const snapshot = await prisma.submissionExpenseHeadSnapshot.create({
      data: {
        submissionId: submission.id,
        expenseHeadId: head.id,
        expenseHeadGlNameAtSnapshot: 'Rent',
        expenseHeadGlNoAtSnapshot: 'GL-1',
      },
    });
    await prisma.provisionEntry.create({
      data: {
        submissionId: submission.id,
        snapshotId: snapshot.id,
        amount: '100.00',
        enteredById: spoc.id,
        lastModifiedById: spoc.id,
      },
    });
    await prisma.submissionComment.create({
      data: {
        submissionId: submission.id,
        comment: 'Rent is up this month.',
        commentedById: spoc.id,
        roleAtTime: UserRole.CLINIC_SPOC,
        action: CommentAction.SUBMITTED,
      },
    });

    await expectStatus(users.remove(spoc.id, 'admin'), 409);
    await expect(users.remove(spoc.id, 'admin')).rejects.toThrow(
      'This user appears in submission history (1 provision entry, 1 comment) and cannot be deleted. Deactivate the account instead.',
    );
    expect(await prisma.user.findUnique({ where: { id: spoc.id } })).not.toBeNull();
  });

  it('refuses (409) a user whose only trace is an audit row (the FK is SET NULL)', async () => {
    const user = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
    });
    await prisma.auditLog.create({
      data: {
        entityType: 'Clinic',
        entityId: clinicA.id,
        action: AuditAction.CLINIC_UPDATE,
        performedById: user.id,
      },
    });

    // Nothing at the DB level would stop this delete — it would blank performedById.
    await expect(users.remove(user.id, 'admin')).rejects.toThrow('1 audit log entry');
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it('refuses self-delete (400) and the last active Finance Admin (400)', async () => {
    const admin = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_ADMIN,
      clinicIds: [],
    });

    await expectStatus(users.remove(admin.id, admin.id), 400); // own account
    await expectStatus(users.remove(admin.id, 'someone-else'), 400); // last active admin

    // A second ACTIVE admin unblocks it — no one gets locked out.
    const other = await users.create({
      ...base,
      email: email(),
      role: UserRole.FINANCE_ADMIN,
      clinicIds: [],
    });
    await users.remove(admin.id, other.id);
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).toBeNull();
  });

  // ── scope reads ────────────────────────────────────────────────────────────

  it('accessibleClinicIds: the single clinic for clinic roles, all clinics for finance', async () => {
    const spocReq: RequestUser = {
      id: 'x',
      email: 'x',
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
      tokenVersion: 0,
    };
    expect(await scope.accessibleClinicIds(spocReq)).toEqual([clinicA.id]);

    const financeReq: RequestUser = {
      id: 'y',
      email: 'y',
      role: UserRole.FINANCE_MANAGER,
      clinicIds: [],
      tokenVersion: 0,
    };
    expect((await scope.accessibleClinicIds(financeReq)).sort()).toEqual(
      [clinicA.id, clinicB.id].sort(),
    );
  });
});

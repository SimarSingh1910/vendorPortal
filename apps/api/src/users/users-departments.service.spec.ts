// Auth secrets must exist before the module (ConfigService) is built.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.BCRYPT_ROUNDS = '4';

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { CorpDepartment } from '@prisma/client';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from './users.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step C1.3 — corporate user ↔ department assignment. Department-scoped roles
 * (Dept SPOC / Viewer) must hold AT LEAST ONE department and MAY hold MULTIPLE
 * (unlike clinic roles, one clinic each). CORP_FINANCE_MANAGER auto-sees every
 * department and carries NO assignment rows. Any assignment/role change must
 * invalidate the user's sessions immediately (tokenVersion bump).
 */
describe('UsersService — corporate department assignment (multiple per user)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let seq = 0;
  const email = () => `d${(seq += 1)}@test.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
      providers: [PrismaService, AuthService, AuditService, UsersService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UsersService);
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

  const base = { name: 'X', password: 'Secret@123' };

  // ── create ───────────────────────────────────────────────────────────────

  it('rejects a department-role user with NO department (400)', async () => {
    await expectStatus(
      users.create({ ...base, email: email(), role: UserRole.DEPT_SPOC, departmentIds: [] }),
      400,
    );
  });

  it('accepts a department-role user with MULTIPLE departments (de-duplicated)', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptA.id, deptB.id, deptA.id],
    });
    expect([...spoc.departmentIds].sort()).toEqual([deptA.id, deptB.id].sort());
    expect(spoc.clinicIds).toEqual([]);
  });

  it('rejects a department assigned to a non-department role (400)', async () => {
    await expectStatus(
      users.create({
        ...base,
        email: email(),
        role: UserRole.CORP_FINANCE_MANAGER,
        departmentIds: [deptA.id],
      }),
      400,
    );
  });

  it('CORP_FINANCE_MANAGER needs no departments; Dept Viewer takes exactly one', async () => {
    const fm = await users.create({
      ...base,
      email: email(),
      role: UserRole.CORP_FINANCE_MANAGER,
      departmentIds: [],
    });
    expect(fm.departmentIds).toEqual([]);

    const viewer = await users.create({
      ...base,
      email: email(),
      role: UserRole.DEPT_VIEWER,
      departmentIds: [deptA.id],
    });
    expect(viewer.departmentIds).toEqual([deptA.id]);
  });

  it('rejects an invalid department id (400)', async () => {
    await expectStatus(
      users.create({
        ...base,
        email: email(),
        role: UserRole.DEPT_SPOC,
        departmentIds: [deptA.id, 'does-not-exist'],
      }),
      400,
    );
  });

  // ── update ───────────────────────────────────────────────────────────────

  it('widens a one-department user to several on edit, and rejects clearing all (400)', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptA.id],
    });

    const widened = await users.update(
      spoc.id,
      { departmentIds: [deptA.id, deptB.id] },
      'requester',
    );
    expect([...widened.departmentIds].sort()).toEqual([deptA.id, deptB.id].sort());

    // A department-role user may not be left with zero departments.
    await expectStatus(users.update(spoc.id, { departmentIds: [] }, 'requester'), 400);
  });

  it('changing the role to CORP_FINANCE_MANAGER clears the departments', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptA.id, deptB.id],
    });
    const promoted = await users.update(
      spoc.id,
      { role: UserRole.CORP_FINANCE_MANAGER },
      'requester',
    );
    expect(promoted.role).toBe(UserRole.CORP_FINANCE_MANAGER);
    expect(promoted.departmentIds).toEqual([]);
  });

  // ── immediate effect ───────────────────────────────────────────────────────

  it('a department-assignment change invalidates sessions immediately (tokenVersion bump)', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.DEPT_SPOC,
      departmentIds: [deptA.id],
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: spoc.id } });

    await users.update(spoc.id, { departmentIds: [deptA.id, deptB.id] }, 'requester');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: spoc.id } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    // A no-op assignment update (same set) is not security-relevant → no bump.
    await users.update(spoc.id, { departmentIds: [deptB.id, deptA.id] }, 'requester');
    const noop = await prisma.user.findUniqueOrThrow({ where: { id: spoc.id } });
    expect(noop.tokenVersion).toBe(after.tokenVersion);
  });
});

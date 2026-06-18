// Auth secrets must exist before the module (ConfigService) is built.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.BCRYPT_ROUNDS = '4';

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Clinic } from '@prisma/client';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { UsersService } from './users.service';
import type { RequestUser } from '../auth/request-user';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step 2 — clinic-role users (Manager / SPOC / Viewer) must be assigned to
 * exactly one clinic; finance roles carry none. Validation lives in UsersService
 * (cross-field role↔clinic), with the scope reads confirmed via ClinicScopeService.
 */
describe('UsersService — one clinic per clinic-role user (Step 2)', () => {
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
      data: { name: 'Clinic A', location: 'A', corporateClient: 'HCL', isActive: true },
    });
    clinicB = await prisma.clinic.create({
      data: { name: 'Clinic B', location: 'B', corporateClient: 'HCL', isActive: true },
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

  it('rejects a clinic-role user with MORE THAN ONE clinic (400)', async () => {
    await expectStatus(
      users.create({
        ...base,
        email: email(),
        role: UserRole.CLINIC_MANAGER,
        clinicIds: [clinicA.id, clinicB.id],
      }),
      400,
    );
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

  it('rejects widening a one-clinic user to two on edit (400)', async () => {
    const spoc = await users.create({
      ...base,
      email: email(),
      role: UserRole.CLINIC_SPOC,
      clinicIds: [clinicA.id],
    });
    await expectStatus(
      users.update(spoc.id, { clinicIds: [clinicA.id, clinicB.id] }, 'requester'),
      400,
    );
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

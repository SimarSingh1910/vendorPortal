// Auth secrets must exist before the module (ConfigService) is built.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.BCRYPT_ROUNDS = '4';

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PortalTab, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { UsersService } from './users.service';
import { resetDb } from '../../test/reset';

/**
 * The user-management clinic/corporate split (presentation/filtering — same user
 * table). `list(status, portal)` returns only that portal's roles; FINANCE_ADMIN,
 * the single cross-tab account, appears in BOTH lists. No filter → every user.
 */
describe('UsersService — clinic/corporate role-group filter', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let seq = 0;
  const email = () => `u${(seq += 1)}@portal.test`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
      providers: [PrismaService, AuthService, AuditService, ClinicScopeService, UsersService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UsersService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const rolesOf = (list: { role: UserRole }[]) => list.map((u) => u.role);

  it('clinic lists only clinic roles, corporate only corporate, FINANCE_ADMIN in both', async () => {
    const clinic = await prisma.clinic.create({
      data: {
        name: 'C',
        accLocationCode: 'ACC-C',
        customerCode: 'CUST-C',
        isActive: true,
      },
    });
    const dept = await prisma.corpDepartment.create({ data: { name: 'Dept', isActive: true } });
    const base = { name: 'X', password: 'Secret@123' };

    await users.create({ ...base, email: email(), role: UserRole.FINANCE_ADMIN });
    await users.create({ ...base, email: email(), role: UserRole.FINANCE_MANAGER });
    await users.create({ ...base, email: email(), role: UserRole.CLINIC_SPOC, clinicIds: [clinic.id] });
    await users.create({ ...base, email: email(), role: UserRole.CORP_FINANCE_MANAGER });
    await users.create({ ...base, email: email(), role: UserRole.DEPT_SPOC, departmentIds: [dept.id] });

    const clinicRoles = rolesOf(await users.list('all', PortalTab.CLINIC));
    expect(clinicRoles).toEqual(
      expect.arrayContaining([UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER, UserRole.CLINIC_SPOC]),
    );
    expect(clinicRoles).not.toContain(UserRole.CORP_FINANCE_MANAGER);
    expect(clinicRoles).not.toContain(UserRole.DEPT_SPOC);

    const corpRoles = rolesOf(await users.list('all', PortalTab.CORPORATE));
    expect(corpRoles).toEqual(
      expect.arrayContaining([
        UserRole.FINANCE_ADMIN,
        UserRole.CORP_FINANCE_MANAGER,
        UserRole.DEPT_SPOC,
      ]),
    );
    expect(corpRoles).not.toContain(UserRole.FINANCE_MANAGER);
    expect(corpRoles).not.toContain(UserRole.CLINIC_SPOC);

    // FINANCE_ADMIN — the one shared account — appears in BOTH lists, exactly once each.
    expect(clinicRoles.filter((r) => r === UserRole.FINANCE_ADMIN)).toHaveLength(1);
    expect(corpRoles.filter((r) => r === UserRole.FINANCE_ADMIN)).toHaveLength(1);

    // No portal filter → every user.
    expect(await users.list('all')).toHaveLength(5);
  });
});

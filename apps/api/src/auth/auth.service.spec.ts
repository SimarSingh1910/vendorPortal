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
import { AuthService } from './auth.service';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Auth flows (Phase 13.1 acceptance). These lock login / refresh-rotation /
 * reuse-detection / logout / immediate-invalidation at the service level — the
 * cookie controller is a thin wrapper around exactly these methods.
 */
describe('AuthService flows', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;

  const PASSWORD = 'Secret@123';
  let seq = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
      providers: [PrismaService, AuthService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function makeUser(opts: { active?: boolean; role?: UserRole } = {}) {
    const hash = await auth.hashPassword(PASSWORD);
    return prisma.user.create({
      data: {
        name: 'U',
        email: `auth${(seq += 1)}@t.local`,
        passwordHash: hash,
        role: opts.role ?? UserRole.FINANCE_ADMIN,
        isActive: opts.active ?? true,
      },
    });
  }

  it('logs in with valid credentials and rejects bad ones', async () => {
    const user = await makeUser();

    const session = await auth.login(user.email, PASSWORD);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.user.id).toBe(user.id);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);

    await expectStatus(auth.login(user.email, 'wrong'), 401);
    await expectStatus(auth.login('nobody@t.local', PASSWORD), 401);
  });

  it('refuses login for a deactivated account', async () => {
    const user = await makeUser({ active: false });
    await expectStatus(auth.login(user.email, PASSWORD), 401);
  });

  // ── Portal-scoped sign-in (the login tabs) ──────────────────────────────────
  // The tab the credentials were entered on is enforced HERE, against the
  // account's own role — the client's choice of tab is a hint, never the gate.

  it('a clinic-only account is refused on the Corporate tab and accepted on Clinic', async () => {
    const spoc = await makeUser({ role: UserRole.CLINIC_SPOC });

    await expectStatus(auth.login(spoc.email, PASSWORD, PortalTab.CORPORATE), 401);
    // Right password, wrong portal — nothing is issued.
    expect(await prisma.refreshToken.count({ where: { userId: spoc.id } })).toBe(0);

    const ok = await auth.login(spoc.email, PASSWORD, PortalTab.CLINIC);
    expect(ok.user.id).toBe(spoc.id);
  });

  it('a corporate-only account is refused on the Clinic tab and accepted on Corporate', async () => {
    const deptSpoc = await makeUser({ role: UserRole.DEPT_SPOC });

    await expectStatus(auth.login(deptSpoc.email, PASSWORD, PortalTab.CLINIC), 401);
    expect(await prisma.refreshToken.count({ where: { userId: deptSpoc.id } })).toBe(0);

    const ok = await auth.login(deptSpoc.email, PASSWORD, PortalTab.CORPORATE);
    expect(ok.user.id).toBe(deptSpoc.id);
  });

  it('FINANCE_ADMIN spans both portals, and omitting the tab keeps the old behaviour', async () => {
    const admin = await makeUser({ role: UserRole.FINANCE_ADMIN });
    expect((await auth.login(admin.email, PASSWORD, PortalTab.CLINIC)).user.id).toBe(admin.id);
    expect((await auth.login(admin.email, PASSWORD, PortalTab.CORPORATE)).user.id).toBe(admin.id);

    // No tab supplied → authenticates unrestricted, so scripts and older clients
    // that don't know about portals are unaffected.
    const clinicOnly = await makeUser({ role: UserRole.CLINIC_MANAGER });
    expect((await auth.login(clinicOnly.email, PASSWORD)).user.id).toBe(clinicOnly.id);
  });

  it('the wrong-portal refusal never leaks whether the account exists', async () => {
    const spoc = await makeUser({ role: UserRole.CLINIC_SPOC });

    // A BAD password on the wrong tab must fail as plain bad credentials — the
    // portal hint is only ever given once the password has been proved.
    const badPassword = await auth
      .login(spoc.email, 'wrong', PortalTab.CORPORATE)
      .catch((e: Error) => e);
    expect((badPassword as Error).message).toBe('Invalid credentials');

    // An unknown address on either tab says the same thing.
    const unknown = await auth
      .login('ghost@t.local', PASSWORD, PortalTab.CORPORATE)
      .catch((e: Error) => e);
    expect((unknown as Error).message).toBe('Invalid credentials');

    // Only a VERIFIED password gets the helpful "use the other tab" message.
    const rightPassword = await auth
      .login(spoc.email, PASSWORD, PortalTab.CORPORATE)
      .catch((e: Error) => e);
    expect((rightPassword as Error).message).toContain('Clinic tab');
  });

  it('rotates the refresh token: old becomes unusable, new works', async () => {
    const user = await makeUser();
    const first = await auth.login(user.email, PASSWORD);

    const second = await auth.refresh(first.refreshToken);
    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // The new token works; the old one is revoked (reuse).
    const third = await auth.refresh(second.refreshToken);
    expect(third.refreshToken).toBeTruthy();
  });

  it('detects reuse of a rotated token and nukes the whole chain', async () => {
    const user = await makeUser();
    const a = await auth.login(user.email, PASSWORD);
    const b = await auth.refresh(a.refreshToken); // A -> B, A revoked

    // Replaying A (already used) is reuse → 401 and every live token revoked.
    await expectStatus(auth.refresh(a.refreshToken), 401);
    // B is now dead too.
    await expectStatus(auth.refresh(b.refreshToken), 401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('logout revokes the token and is idempotent', async () => {
    const user = await makeUser();
    const session = await auth.login(user.email, PASSWORD);

    expect(await auth.logout(session.refreshToken)).toEqual({ success: true });
    // The revoked token can no longer refresh.
    await expectStatus(auth.refresh(session.refreshToken), 401);
    // Logging out again is harmless.
    expect(await auth.logout(session.refreshToken)).toEqual({ success: true });
  });

  it('invalidateUserSessions immediately kills access + refresh', async () => {
    const user = await makeUser();
    const session = await auth.login(user.email, PASSWORD);
    // Access token valid before invalidation.
    expect(await auth.verifyAccessToken(session.accessToken)).toBe(user.id);

    await auth.invalidateUserSessions(user.id);

    // Access token now fails the tokenVersion check; refresh token is revoked.
    await expectStatus(auth.verifyAccessToken(session.accessToken), 401);
    await expectStatus(auth.refresh(session.refreshToken), 401);
  });

  it('verifyAccessToken rejects garbage', async () => {
    await expectStatus(auth.verifyAccessToken('not-a-jwt'), 401);
  });
});

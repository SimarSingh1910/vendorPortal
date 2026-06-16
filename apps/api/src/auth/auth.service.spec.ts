// Auth secrets must exist before the module (ConfigService) is built.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.BCRYPT_ROUNDS = '4';

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UserRole } from '@portal/shared';
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

  async function makeUser(opts: { active?: boolean } = {}) {
    const hash = await auth.hashPassword(PASSWORD);
    return prisma.user.create({
      data: {
        name: 'U',
        email: `auth${(seq += 1)}@t.local`,
        passwordHash: hash,
        role: UserRole.FINANCE_ADMIN,
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

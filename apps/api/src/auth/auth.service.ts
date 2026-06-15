import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import type { AuthResponse, AuthUser, JwtClaims, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';

/** `ms`-style duration string (e.g. "15m", "7d") or seconds; matches jsonwebtoken. */
type ExpiresIn = JwtSignOptions['expiresIn'];

/** Payload carried by the refresh JWT. `jti` is the RefreshToken row id. */
interface RefreshClaims {
  sub: string;
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Public endpoints ───────────────────────────────────────────────────────

  /** Verify credentials and issue the first token pair. */
  async login(email: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same generic error whether the email is unknown, the password is wrong, or
    // the account is deactivated — never leak which.
    if (!user || !user.isActive) {
      // Still hash-compare against a dummy when the user is missing to blunt
      // timing-based user enumeration.
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  /**
   * Rotate: validate the presented refresh token, revoke it, and issue a fresh
   * pair. Presenting an already-revoked token is treated as reuse and revokes
   * every live refresh token for that user.
   */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const claims = this.verifyRefreshToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { id: claims.jti } });
    if (!stored || stored.userId !== claims.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: a revoked token being replayed means the chain is
    // compromised — nuke all of this user's live tokens.
    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (stored.tokenHash !== hashToken(refreshToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Issue the successor first, then revoke the old row and link the chain.
    const result = await this.issueTokens(user);
    const newJti = this.decodeJti(result.refreshToken);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: newJti },
    });
    return result;
  }

  /** Idempotently revoke the presented refresh token. */
  async logout(refreshToken: string): Promise<{ success: true }> {
    let claims: RefreshClaims;
    try {
      claims = this.verifyRefreshToken(refreshToken);
    } catch {
      // Already-invalid token => nothing to do; logout is idempotent.
      return { success: true };
    }
    await this.prisma.refreshToken.updateMany({
      where: { id: claims.jti, userId: claims.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Hash a plaintext password with the project's bcrypt cost (BCRYPT_ROUNDS, >= 12). */
  hashPassword(plain: string): Promise<string> {
    const rounds = Number(this.config.get<string>('BCRYPT_ROUNDS', '12'));
    return bcrypt.hash(plain, rounds);
  }

  /**
   * The authenticated user's profile, for session bootstrap (GET /auth/me).
   * Loads name + current clinic assignments fresh from the DB.
   */
  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { assignments: { select: { clinicId: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return toAuthUser(
      user,
      user.assignments.map((a) => a.clinicId),
    );
  }

  /**
   * Immediately invalidate every active session for a user, atomically:
   *  1. bump `tokenVersion` — outstanding access tokens now fail the guard's
   *     version check on their very next request (no 15-min TTL wait);
   *  2. revoke all live refresh tokens — they can no longer be rotated.
   *
   * Call this on ANY change to a user's role, isActive, or clinic assignments.
   * Centralized here so Phase 4 (user management) reuses a single code path.
   */
  async invalidateUserSessions(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async issueTokens(user: User): Promise<AuthResponse> {
    const assignments = await this.prisma.userClinicAssignment.findMany({
      where: { userId: user.id },
      select: { clinicId: true },
    });
    const clinicIds = assignments.map((a) => a.clinicId);

    const accessClaims: JwtClaims = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      clinicIds,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = await this.jwt.signAsync(accessClaims, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m') as ExpiresIn,
    });

    // jti is the row id, generated up front so it can be embedded in the token.
    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti } satisfies RefreshClaims,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL', '7d') as ExpiresIn,
      },
    );

    const expiresAt = this.expiryOf(refreshToken);
    await this.prisma.refreshToken.create({
      data: { id: jti, userId: user.id, tokenHash: hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, user: toAuthUser(user, clinicIds) };
  }

  private verifyRefreshToken(token: string): RefreshClaims {
    try {
      return this.jwt.verify<RefreshClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private decodeJti(token: string): string {
    return this.jwt.decode<RefreshClaims>(token).jti;
  }

  /** Translate the token's `exp` (seconds) into a Date for the DB row. */
  private expiryOf(token: string): Date {
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return new Date(exp * 1000);
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

/** A throwaway bcrypt hash (of a random value) for constant-time login failures. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO9oo8sA0v7Tq2c1gUyD0CgZ0kQ8b7uYK';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAuthUser(user: User, clinicIds: string[]): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    clinicIds,
  };
}

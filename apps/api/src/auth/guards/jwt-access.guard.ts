import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtClaims, UserRole } from '@portal/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../request-user';

/**
 * Global guard for every route not marked @Public(). It verifies the access JWT
 * and then re-checks the user against the DB on each request, so deactivation,
 * a role change, or a tokenVersion bump revokes outstanding access tokens
 * IMMEDIATELY — no waiting for the 15-min access TTL to lapse.
 *
 * A per-request user lookup is acceptable at this scale; a short-TTL cache can
 * be layered on later if it ever matters.
 */
@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();

    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    // Immediate-revocation check: the user must still exist, be active, and carry
    // the same tokenVersion the token was stamped with.
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive || claims.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Token no longer valid');
    }

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      // clinicIds are stamped into the token at issue time; any assignment change
      // is accompanied by a tokenVersion bump, which forces re-issue above.
      clinicIds: claims.clinicIds ?? [],
      tokenVersion: user.tokenVersion,
    };
    return true;
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value ? value : null;
  }
}

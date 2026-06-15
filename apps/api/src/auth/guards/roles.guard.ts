import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@portal/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../request-user';

/**
 * Enforces @Roles(...) metadata. Runs after JwtAccessGuard, so request.user is
 * populated. Routes without @Roles are unrestricted beyond authentication.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user || !allowed.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}

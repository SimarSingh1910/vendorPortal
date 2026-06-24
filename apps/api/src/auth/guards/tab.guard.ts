import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PortalTab, roleCanAccessTab } from '@portal/shared';
import { REQUIRE_TAB_KEY } from '../decorators/require-tab.decorator';
import type { RequestUser } from '../request-user';

/**
 * Enforces @RequireTab(...) metadata — the backend half of tab visibility.
 * Runs after JwtAccessGuard (so request.user is populated) and RolesGuard.
 * Routes without @RequireTab are unrestricted by this guard.
 *
 * Tab membership comes from the shared role→tab derivation (roleCanAccessTab),
 * keeping one source of truth across the frontend router and the API. This is
 * what blocks a corporate-only role from clinic APIs and a clinic-only role
 * (incl. the clinic FINANCE_MANAGER) from corporate APIs; FINANCE_ADMIN, the
 * only cross-tab role, passes both.
 */
@Injectable()
export class TabGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PortalTab | undefined>(REQUIRE_TAB_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user || !roleCanAccessTab(user.role, required)) {
      throw new ForbiddenException('Not permitted for this portal tab');
    }
    return true;
  }
}

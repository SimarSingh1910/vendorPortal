import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from '../request-user';

/**
 * Inject the authenticated RequestUser populated by JwtAccessGuard.
 * Only meaningful on routes behind the guard (i.e. not @Public()).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    return request.user;
  },
);

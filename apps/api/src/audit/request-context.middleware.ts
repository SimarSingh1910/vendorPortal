import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext, type RequestContextStore } from './request-context';

/**
 * Opens an AsyncLocalStorage scope for each request and stores the Express
 * request (which exposes `ip` and, after JwtAccessGuard, `user`). Everything
 * downstream — guards, the handler, services — runs inside this scope, so the
 * audit writer can resolve actor + IP from context. Applied to all routes.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  runWithRequestContext(req as unknown as RequestContextStore, () => next());
}

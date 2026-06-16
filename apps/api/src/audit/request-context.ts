import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request store carrying the acting principal + client IP, so the audit
 * writer can read them WITHOUT every service threading actor/IP through its
 * signature. Populated at the HTTP boundary (requestContextMiddleware) from the
 * Express request; the express Request itself satisfies this shape (`ip`, and
 * `user` set by JwtAccessGuard). Read lazily, after the guard has run.
 *
 * Outside any request (e.g. the scheduler) there is no store → SYSTEM actor with
 * null IP.
 */
export interface RequestContextStore {
  ip?: string | null;
  user?: { id?: string | null } | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** The current actor + IP, or nulls (SYSTEM) when there is no request context. */
export function currentActor(): { userId: string | null; ipAddress: string | null } {
  const store = storage.getStore();
  return { userId: store?.user?.id ?? null, ipAddress: store?.ip ?? null };
}

import type { Request, Response } from 'express';

/**
 * Refresh-token cookie (Phase 13.1). The refresh token lives ONLY in this
 * httpOnly cookie — never the response body, never JS-readable — so an XSS payload
 * cannot exfiltrate it. Scoped by `path` to the auth routes so it isn't sent on
 * ordinary API calls.
 *
 * In production the web and API are served from DIFFERENT domains (e.g. Railway),
 * so the cookie must be SameSite=None; Secure — otherwise the browser drops it on
 * the cross-site /auth/refresh call and the session silently dies on refresh.
 * Outside production (dev/test over plain http) we use SameSite=Lax without Secure
 * so the same cookie works on http://localhost — see docs/DEPLOYMENT.md.
 */
export const REFRESH_COOKIE = 'cpp_refresh';
const COOKIE_PATH = '/api/auth';

/** True in production (our 'prod' convention or Node/Railway's 'production'). */
function isProduction(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'prod' || env === 'production';
}

/** Secure cookies everywhere except local dev/test (which run over plain http). */
function secure(): boolean {
  const env = process.env.NODE_ENV;
  return env !== 'dev' && env !== 'test';
}

/**
 * Cookie cross-site attributes, kept in one place so set/clear match exactly
 * (clearCookie only clears when the attributes line up). In production the
 * refresh cookie must be SameSite=None (which mandates Secure) to ride the
 * cross-domain auth calls; elsewhere Lax is correct, and Secure follows the
 * usual dev/test-over-http exception above.
 */
function crossSiteOptions(): { secure: boolean; sameSite: 'none' | 'lax' } {
  return isProduction() ? { secure: true, sameSite: 'none' } : { secure: secure(), sameSite: 'lax' };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    ...crossSiteOptions(),
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    ...crossSiteOptions(),
    path: COOKIE_PATH,
  });
}

/** Read the refresh token from the request's Cookie header (no cookie-parser dep). */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

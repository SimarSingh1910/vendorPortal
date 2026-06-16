import type { Request, Response } from 'express';

/**
 * Refresh-token cookie (Phase 13.1). The refresh token lives ONLY in this
 * httpOnly cookie — never the response body, never JS-readable — so an XSS payload
 * cannot exfiltrate it. Scoped by `path` to the auth routes so it isn't sent on
 * ordinary API calls.
 *
 * SameSite=Lax + Secure (outside dev) suits the current same-site deployment
 * (web and API under the same registrable domain). If a deployment splits the web
 * and API across DIFFERENT sites, switch SameSite to 'none' (which forces Secure)
 * — see docs/DEPLOYMENT.md.
 */
export const REFRESH_COOKIE = 'cpp_refresh';
const COOKIE_PATH = '/api/auth';

/** Secure cookies everywhere except local dev/test (which run over plain http). */
function secure(): boolean {
  const env = process.env.NODE_ENV;
  return env !== 'dev' && env !== 'test';
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
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

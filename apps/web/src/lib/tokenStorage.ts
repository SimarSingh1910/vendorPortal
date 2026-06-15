/**
 * Refresh-token persistence.
 *
 * The ACCESS token lives in memory only (auth store). The REFRESH token is
 * persisted so a page reload can re-establish the session via /auth/refresh.
 * localStorage is used because the backend returns the refresh token in the
 * response body (no httpOnly cookie). A future hardening would move the refresh
 * token into an httpOnly, SameSite cookie set by the API; the rest of the client
 * flow would be unchanged.
 */
const REFRESH_TOKEN_KEY = 'cpp.refreshToken';

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}

export function clearStoredRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

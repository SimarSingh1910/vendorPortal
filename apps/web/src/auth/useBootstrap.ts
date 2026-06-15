import { useEffect } from 'react';
import type { AuthUser } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';
import { useAuthStore } from '@/store/auth.store';
import { getStoredRefreshToken } from '@/lib/tokenStorage';

/**
 * One-shot session bootstrap on app load.
 *
 * If a refresh token may exist, GET /auth/me is attempted. On reload the access
 * token (memory-only) is gone, so /me 401s and the API client transparently
 * refreshes using the stored refresh token, then replays /me — re-establishing
 * the session. If there's no refresh token, or refresh fails, the user is
 * marked unauthenticated. Either way `status` leaves 'pending', ungating the UI.
 */
export function useBootstrap(): void {
  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      if (!getStoredRefreshToken()) {
        useAuthStore.getState().setStatus('unauthenticated');
        return;
      }
      try {
        const { data } = await apiClient.get<AuthUser>('/auth/me');
        if (!cancelled) {
          useAuthStore.getState().setUser(data);
        }
      } catch {
        if (!cancelled) {
          useAuthStore.getState().clear();
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);
}

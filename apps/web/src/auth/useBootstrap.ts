import { useEffect } from 'react';
import type { AuthUser } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';
import { useAuthStore } from '@/store/auth.store';

/**
 * One-shot session bootstrap on app load.
 *
 * The access token is memory-only, so on reload it's gone. We attempt GET
 * /auth/me; it 401s, and the API client transparently refreshes using the
 * httpOnly refresh COOKIE (Phase 13.1), then replays /me — re-establishing the
 * session. With no valid cookie the refresh fails and the user is marked
 * unauthenticated. Either way `status` leaves 'pending', ungating the UI.
 */
export function useBootstrap(): void {
  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
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

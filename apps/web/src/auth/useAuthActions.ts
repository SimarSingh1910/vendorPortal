import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AuthResponse, PortalTab } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/auth.store';
import { tabHome } from '@/auth/roles';

export interface LoginCredentials {
  email: string;
  password: string;
  /**
   * The portal tab the sign-in was made from. The API rejects an account that
   * isn't entitled to it, so this is a real credential-scoping input, not a UI
   * preference.
   */
  portal: PortalTab;
}

/**
 * Login (React Query mutation) + logout. The access token is kept in memory
 * (auth store); the refresh token lives only in an httpOnly cookie the API sets,
 * so there is nothing token-related to persist in JS (Phase 13.1).
 */
export function useAuthActions() {
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: async (credentials: LoginCredentials): Promise<AuthResponse> => {
      const { data } = await apiClient.post<AuthResponse>('/auth/login', credentials);
      return data;
    },
    onSuccess: (data, credentials) => {
      useAuthStore.getState().setSession(data.accessToken, data.user);
      queryClient.clear();
      // Land in the tab they signed in from. Only differs for FINANCE_ADMIN, the
      // one role in both portals: signing in on Corporate should open Corporate,
      // not their clinic home.
      navigate(tabHome(data.user.role, credentials.portal), { replace: true });
    },
  });

  const logout = useCallback(async (): Promise<void> => {
    try {
      // Revoke the refresh token + clear its cookie server-side (idempotent,
      // public; the cookie is sent automatically).
      await apiClient.post('/auth/logout');
    } catch {
      /* even if the call fails, clear local state below */
    }
    useAuthStore.getState().clear();
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [navigate]);

  return { login, logout };
}

import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AuthResponse } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/auth.store';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
} from '@/lib/tokenStorage';
import { roleHome } from '@/auth/roles';

export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Login (React Query mutation) + logout. Both keep the access token in memory
 * (auth store) and the refresh token in storage, and navigate appropriately.
 */
export function useAuthActions() {
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: async (credentials: LoginCredentials): Promise<AuthResponse> => {
      const { data } = await apiClient.post<AuthResponse>('/auth/login', credentials);
      return data;
    },
    onSuccess: (data) => {
      useAuthStore.getState().setSession(data.accessToken, data.user);
      setStoredRefreshToken(data.refreshToken);
      queryClient.clear();
      navigate(roleHome(data.user.role), { replace: true });
    },
  });

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = getStoredRefreshToken();
    try {
      // Revoke the refresh token server-side (idempotent, public endpoint).
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken });
      }
    } catch {
      /* even if the call fails, clear local state below */
    }
    useAuthStore.getState().clear();
    clearStoredRefreshToken();
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [navigate]);

  return { login, logout };
}

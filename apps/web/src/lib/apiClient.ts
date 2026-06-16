import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { AuthResponse } from '@portal/shared';
import { useAuthStore } from '@/store/auth.store';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

// `withCredentials` so the browser sends/stores the httpOnly refresh cookie
// (Phase 13.1) on the cross-origin auth calls. The access token stays in memory.
export const apiClient = axios.create({ baseURL, withCredentials: true });

/** Bare client for the refresh call itself, so it never re-enters the interceptor. */
const refreshClient = axios.create({ baseURL, withCredentials: true });

// Attach the in-memory access token to every request.
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Single in-flight refresh shared by all concurrent 401s. */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // No body — the refresh token rides in the httpOnly cookie. The API rotates it
  // and sets a fresh cookie; we keep only the new access token (in memory).
  const { data } = await refreshClient.post<AuthResponse>('/auth/refresh');
  useAuthStore.getState().setSession(data.accessToken, data.user);
  return data.accessToken;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// On 401, try a single refresh + replay. If refresh fails, the session is dead:
// clear auth state (which bounces the user to /login via route guards).
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    const isAuthCall = url.includes('/auth/refresh') || url.includes('/auth/login');

    if (status !== 401 || !original || original._retry || isAuthCall) {
      return Promise.reject(error);
    }

    original._retry = true;
    try {
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const newToken = await refreshPromise;
      refreshPromise = null;
      original.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(original);
    } catch (refreshError) {
      refreshPromise = null;
      useAuthStore.getState().clear();
      return Promise.reject(refreshError);
    }
  },
);

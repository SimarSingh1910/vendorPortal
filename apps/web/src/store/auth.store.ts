import { create } from 'zustand';
import type { AuthUser } from '@portal/shared';

/**
 * 'pending' until the initial bootstrap (GET /auth/me) resolves — rendering is
 * gated on this so we never flash the login page for a user who actually has a
 * live refresh session.
 */
export type AuthStatus = 'pending' | 'authenticated' | 'unauthenticated';

interface AuthState {
  /** Access token kept in MEMORY ONLY (never localStorage). */
  accessToken: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  /** Set on login and on refresh (token rotation). */
  setSession: (accessToken: string, user: AuthUser) => void;
  /** Refresh the profile without changing the token (e.g. after /auth/me). */
  setUser: (user: AuthUser) => void;
  setStatus: (status: AuthStatus) => void;
  /** Wipe the in-memory session; marks the user unauthenticated. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'pending',
  setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),
  setUser: (user) => set({ user, status: 'authenticated' }),
  setStatus: (status) => set({ status }),
  clear: () => set({ accessToken: null, user: null, status: 'unauthenticated' }),
}));

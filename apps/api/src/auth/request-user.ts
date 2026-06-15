import type { UserRole } from '@portal/shared';

/**
 * Authenticated principal attached to `request.user` by JwtAccessGuard after a
 * successful access-token verification. Available to downstream guards
 * (RolesGuard) and handlers (via the @CurrentUser() decorator).
 */
export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  clinicIds: string[];
  tokenVersion: number;
}

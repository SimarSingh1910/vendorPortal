import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { UserRole } from '@portal/shared';

/** Metadata key read by RolesGuard to find a route's allowed roles. */
export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or controller) to the given roles. Enforced by RolesGuard,
 * which runs after JwtAccessGuard. Pass roles from rbac.constants / UserRole —
 * never string literals.
 */
export const Roles = (...roles: UserRole[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PortalTab } from '@portal/shared';

/** Metadata key read by TabGuard to find a route's required portal tab. */
export const REQUIRE_TAB_KEY = 'requireTab';

/**
 * Restrict a route (or controller) to users whose role may see the given portal
 * tab. Enforced by TabGuard, which runs after JwtAccessGuard/RolesGuard. Apply
 * at the CONTROLLER level so every endpoint of a tab-specific module is gated in
 * one place — e.g. `@RequireTab(PortalTab.CLINIC)` on clinic controllers and
 * `@RequireTab(PortalTab.CORPORATE)` on corporate ones.
 *
 * Tab access is derived from the SHARED role→tab map (roleCanAccessTab), so
 * FINANCE_ADMIN (the only cross-tab role) passes either tab while a clinic-only
 * role is rejected from corporate routes and vice-versa.
 */
export const RequireTab = (tab: PortalTab): CustomDecorator =>
  SetMetadata(REQUIRE_TAB_KEY, tab);

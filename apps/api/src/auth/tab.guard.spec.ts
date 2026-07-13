import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { TabGuard } from './guards/tab.guard';
import { RequireTab } from './decorators/require-tab.decorator';
import { DashboardController } from '../dashboard/dashboard.controller';

/**
 * Step C0.1 — tab visibility at the API edge. TabGuard derives a user's allowed
 * tab(s) from the shared role→tab map and rejects cross-tab access:
 *   - corporate-only roles get 403 on clinic (CLINIC-tab) APIs,
 *   - clinic-only roles — incl. the clinic FINANCE_MANAGER — get 403 on
 *     corporate (CORPORATE-tab) APIs,
 *   - FINANCE_ADMIN (the only cross-tab role) passes both,
 *   - routes without @RequireTab are unaffected.
 */

// A stand-in for a future corporate controller, gated to the Corporate tab.
@RequireTab(PortalTab.CORPORATE)
class FakeCorporateController {
  handler(): void {}
}

// A route with no @RequireTab — the guard must let everyone through.
class UntaggedController {
  handler(): void {}
}

describe('TabGuard — cross-tab enforcement (Step C0.1)', () => {
  const guard = new TabGuard(new Reflector());
  const ctx = (role: UserRole, handler: unknown, cls: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  const clinicRoles = [
    UserRole.FINANCE_MANAGER,
    UserRole.CLINIC_MANAGER,
    UserRole.CLINIC_SPOC,
    UserRole.CLINIC_VIEWER,
  ];
  const corporateRoles = [UserRole.CORP_FINANCE_MANAGER, UserRole.DEPT_SPOC, UserRole.DEPT_VIEWER];

  // ── Clinic (CLINIC-tab) APIs ────────────────────────────────────────────────

  it('lets clinic roles and FINANCE_ADMIN reach a CLINIC-tab controller', () => {
    for (const role of [...clinicRoles, UserRole.FINANCE_ADMIN]) {
      expect(
        guard.canActivate(ctx(role, DashboardController.prototype.status, DashboardController)),
      ).toBe(true);
    }
  });

  it('blocks every corporate-only role from a CLINIC-tab controller (403)', () => {
    for (const role of corporateRoles) {
      expect(() =>
        guard.canActivate(ctx(role, DashboardController.prototype.status, DashboardController)),
      ).toThrow(ForbiddenException);
    }
  });

  // ── Corporate (CORPORATE-tab) APIs ──────────────────────────────────────────

  it('lets corporate roles and FINANCE_ADMIN reach a CORPORATE-tab controller', () => {
    for (const role of [...corporateRoles, UserRole.FINANCE_ADMIN]) {
      expect(
        guard.canActivate(ctx(role, FakeCorporateController.prototype.handler, FakeCorporateController)),
      ).toBe(true);
    }
  });

  it('blocks every clinic-only role — incl. clinic FINANCE_MANAGER — from a CORPORATE-tab controller (403)', () => {
    for (const role of clinicRoles) {
      expect(() =>
        guard.canActivate(
          ctx(role, FakeCorporateController.prototype.handler, FakeCorporateController),
        ),
      ).toThrow(ForbiddenException);
    }
  });

  // ── No @RequireTab → unrestricted ───────────────────────────────────────────

  it('allows any role on a route without @RequireTab', () => {
    for (const role of [...clinicRoles, ...corporateRoles, UserRole.FINANCE_ADMIN]) {
      expect(
        guard.canActivate(ctx(role, UntaggedController.prototype.handler, UntaggedController)),
      ).toBe(true);
    }
  });
});

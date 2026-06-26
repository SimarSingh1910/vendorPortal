import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabGuard } from '../auth/guards/tab.guard';
import { CorpCycleAdminController } from './corp-cycle-admin.controller';

/**
 * Step C5.2 — the manual "open now / re-run" endpoint (POST /corp/cycles/:month/open)
 * is FINANCE_ADMIN-only: RolesGuard 403s every other role, and TabGuard keeps
 * clinic-only roles (incl. the clinic FINANCE_MANAGER) off this CORPORATE-tab
 * controller. FINANCE_ADMIN, the only cross-tab role, passes both. This is the
 * "admin only, 403 otherwise" half of the acceptance check.
 */
describe('Corporate cycle admin RBAC (Step C5.2)', () => {
  const roles = new RolesGuard(new Reflector());
  const tabs = new TabGuard(new Reflector());
  const handler = CorpCycleAdminController.prototype.open;
  const cls = CorpCycleAdminController;
  const ctx = (role: UserRole): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  const nonAdminCorporate = [UserRole.CORP_FINANCE_MANAGER, UserRole.DEPT_SPOC, UserRole.DEPT_VIEWER];
  const clinicRoles = [
    UserRole.FINANCE_MANAGER,
    UserRole.CLINIC_MANAGER,
    UserRole.CLINIC_SPOC,
    UserRole.CLINIC_VIEWER,
  ];

  it('FINANCE_ADMIN passes both guards on the manual-open endpoint', () => {
    expect(roles.canActivate(ctx(UserRole.FINANCE_ADMIN))).toBe(true);
    expect(tabs.canActivate(ctx(UserRole.FINANCE_ADMIN))).toBe(true);
  });

  it('every non-admin corporate role is 403 by RolesGuard', () => {
    for (const role of nonAdminCorporate) {
      expect(() => roles.canActivate(ctx(role))).toThrow(ForbiddenException);
    }
  });

  it('every clinic-only role — incl. clinic FINANCE_MANAGER — is 403 by TabGuard', () => {
    for (const role of clinicRoles) {
      expect(() => tabs.canActivate(ctx(role))).toThrow(ForbiddenException);
    }
  });
});

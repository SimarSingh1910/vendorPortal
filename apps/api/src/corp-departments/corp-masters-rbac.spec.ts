import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabGuard } from '../auth/guards/tab.guard';
import { CorpDepartmentsController } from './corp-departments.controller';
import { CorpExpenseHeadsController } from '../corp-expense-heads/corp-expense-heads.controller';
import { CorpBudgetCodesController } from '../corp-budget-codes/corp-budget-codes.controller';

/**
 * Steps C1.1/C1.2 — RBAC at the API edge for corporate masters. Department,
 * expense-head and budget-code MANAGEMENT (incl. reads, since the whole
 * controller is admin-gated) is FINANCE_ADMIN-only: RolesGuard 403s every other
 * role. TabGuard additionally keeps clinic-only roles — including the clinic
 * FINANCE_MANAGER — off these CORPORATE-tab controllers; FINANCE_ADMIN, the only
 * cross-tab role, passes both.
 */
describe('Corporate masters RBAC (Steps C1.1/C1.2)', () => {
  const roles = new RolesGuard(new Reflector());
  const tabs = new TabGuard(new Reflector());
  const ctx = (role: UserRole, handler: unknown, cls: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  // (handler, controller) pairs covering every endpoint of both controllers.
  const endpoints: Array<[string, unknown, unknown]> = [
    ['dept.create', CorpDepartmentsController.prototype.create, CorpDepartmentsController],
    ['dept.list', CorpDepartmentsController.prototype.list, CorpDepartmentsController],
    ['dept.get', CorpDepartmentsController.prototype.get, CorpDepartmentsController],
    ['dept.update', CorpDepartmentsController.prototype.update, CorpDepartmentsController],
    ['dept.deactivate', CorpDepartmentsController.prototype.deactivate, CorpDepartmentsController],
    ['dept.activate', CorpDepartmentsController.prototype.activate, CorpDepartmentsController],
    ['head.create', CorpExpenseHeadsController.prototype.create, CorpExpenseHeadsController],
    ['head.list', CorpExpenseHeadsController.prototype.list, CorpExpenseHeadsController],
    ['head.get', CorpExpenseHeadsController.prototype.get, CorpExpenseHeadsController],
    ['head.update', CorpExpenseHeadsController.prototype.update, CorpExpenseHeadsController],
    ['head.deactivate', CorpExpenseHeadsController.prototype.deactivate, CorpExpenseHeadsController],
    ['head.activate', CorpExpenseHeadsController.prototype.activate, CorpExpenseHeadsController],
    ['code.create', CorpBudgetCodesController.prototype.create, CorpBudgetCodesController],
    ['code.list', CorpBudgetCodesController.prototype.list, CorpBudgetCodesController],
    ['code.get', CorpBudgetCodesController.prototype.get, CorpBudgetCodesController],
    ['code.update', CorpBudgetCodesController.prototype.update, CorpBudgetCodesController],
    ['code.deactivate', CorpBudgetCodesController.prototype.deactivate, CorpBudgetCodesController],
    ['code.activate', CorpBudgetCodesController.prototype.activate, CorpBudgetCodesController],
  ];

  const nonAdminCorporate = [UserRole.CORP_FINANCE_MANAGER, UserRole.DEPT_SPOC, UserRole.DEPT_VIEWER];
  const clinicRoles = [
    UserRole.FINANCE_MANAGER,
    UserRole.CLINIC_MANAGER,
    UserRole.CLINIC_SPOC,
    UserRole.CLINIC_VIEWER,
  ];

  // ── RolesGuard: admin-only ────────────────────────────────────────────────────

  it('FINANCE_ADMIN passes RolesGuard on every corporate-master endpoint', () => {
    for (const [, handler, cls] of endpoints) {
      expect(roles.canActivate(ctx(UserRole.FINANCE_ADMIN, handler, cls))).toBe(true);
    }
  });

  it('every non-admin corporate role is 403 by RolesGuard on every endpoint', () => {
    for (const role of nonAdminCorporate) {
      for (const [, handler, cls] of endpoints) {
        expect(() => roles.canActivate(ctx(role, handler, cls))).toThrow(ForbiddenException);
      }
    }
  });

  // ── TabGuard: corporate-tab only ──────────────────────────────────────────────

  it('FINANCE_ADMIN passes TabGuard (cross-tab) on every endpoint', () => {
    for (const [, handler, cls] of endpoints) {
      expect(tabs.canActivate(ctx(UserRole.FINANCE_ADMIN, handler, cls))).toBe(true);
    }
  });

  it('every clinic-only role — incl. clinic FINANCE_MANAGER — is 403 by TabGuard', () => {
    for (const role of clinicRoles) {
      for (const [, handler, cls] of endpoints) {
        expect(() => tabs.canActivate(ctx(role, handler, cls))).toThrow(ForbiddenException);
      }
    }
  });
});

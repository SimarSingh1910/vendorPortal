import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabGuard } from '../auth/guards/tab.guard';
import { CorpSubmissionWorkflowController } from './corp-submission-workflow.controller';
import { CorpProvisionEntryController } from './corp-provision-entry.controller';
import { CorpSubmissionsController } from './corp-submissions.controller';

/**
 * Phase C2 — RBAC at the API edge for the corporate submission surface.
 *
 *  - TabGuard keeps EVERY clinic-only role — including the clinic FINANCE_MANAGER
 *    — off all corporate routes (the review endpoints among them); FINANCE_ADMIN,
 *    the only cross-tab role, passes.
 *  - RolesGuard gates the approver-only review actions (open/approve/send-back)
 *    and the Finance-Admin-only unlock: a DEPT_SPOC/DEPT_VIEWER is 403 on review,
 *    and a CORP_FINANCE_MANAGER is 403 on unlock.
 */
describe('Corporate submission RBAC (Phase C2)', () => {
  const roles = new RolesGuard(new Reflector());
  const tabs = new TabGuard(new Reflector());
  const ctx = (role: UserRole, handler: unknown, cls: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  const W = CorpSubmissionWorkflowController.prototype;
  const reviewEndpoints: Array<[string, unknown, unknown]> = [
    ['review.open', W.openReview, CorpSubmissionWorkflowController],
    ['review.approve', W.approve, CorpSubmissionWorkflowController],
    ['review.sendBack', W.sendBack, CorpSubmissionWorkflowController],
  ];
  const allWorkflowEndpoints: Array<[string, unknown, unknown]> = [
    ['submit', W.submit, CorpSubmissionWorkflowController],
    ...reviewEndpoints,
    ['unlock', W.unlock, CorpSubmissionWorkflowController],
    ['entries.save', CorpProvisionEntryController.prototype.save, CorpProvisionEntryController],
    ['read.overview', CorpSubmissionsController.prototype.overview, CorpSubmissionsController],
    ['read.queue', CorpSubmissionsController.prototype.reviewQueue, CorpSubmissionsController],
    ['read.detail', CorpSubmissionsController.prototype.detail, CorpSubmissionsController],
  ];

  const clinicRoles = [
    UserRole.FINANCE_MANAGER,
    UserRole.CLINIC_MANAGER,
    UserRole.CLINIC_SPOC,
    UserRole.CLINIC_VIEWER,
  ];

  // ── TabGuard: corporate-tab only ──────────────────────────────────────────────

  it('every clinic-only role — incl. clinic FINANCE_MANAGER — is 403 by TabGuard on all corporate routes', () => {
    for (const role of clinicRoles) {
      for (const [, handler, cls] of allWorkflowEndpoints) {
        expect(() => tabs.canActivate(ctx(role, handler, cls))).toThrow(ForbiddenException);
      }
    }
  });

  it('FINANCE_ADMIN (cross-tab) passes TabGuard on every corporate route', () => {
    for (const [, handler, cls] of allWorkflowEndpoints) {
      expect(tabs.canActivate(ctx(UserRole.FINANCE_ADMIN, handler, cls))).toBe(true);
    }
  });

  // ── RolesGuard: approver-only review actions ───────────────────────────────────

  it('approver roles pass RolesGuard on the review actions; SPOC/Viewer are 403', () => {
    for (const [, handler, cls] of reviewEndpoints) {
      expect(roles.canActivate(ctx(UserRole.CORP_FINANCE_MANAGER, handler, cls))).toBe(true);
      expect(roles.canActivate(ctx(UserRole.FINANCE_ADMIN, handler, cls))).toBe(true);
      expect(() => roles.canActivate(ctx(UserRole.DEPT_SPOC, handler, cls))).toThrow(ForbiddenException);
      expect(() => roles.canActivate(ctx(UserRole.DEPT_VIEWER, handler, cls))).toThrow(
        ForbiddenException,
      );
    }
  });

  // ── RolesGuard: Finance-Admin-only unlock ──────────────────────────────────────

  it('only FINANCE_ADMIN passes RolesGuard on unlock; CORP_FINANCE_MANAGER is 403', () => {
    expect(roles.canActivate(ctx(UserRole.FINANCE_ADMIN, W.unlock, CorpSubmissionWorkflowController))).toBe(
      true,
    );
    expect(() =>
      roles.canActivate(ctx(UserRole.CORP_FINANCE_MANAGER, W.unlock, CorpSubmissionWorkflowController)),
    ).toThrow(ForbiddenException);
  });

  // ── RolesGuard: SPOC-only submit ───────────────────────────────────────────────

  it('only DEPT_SPOC passes RolesGuard on submit; approvers are 403', () => {
    expect(roles.canActivate(ctx(UserRole.DEPT_SPOC, W.submit, CorpSubmissionWorkflowController))).toBe(
      true,
    );
    expect(() =>
      roles.canActivate(ctx(UserRole.CORP_FINANCE_MANAGER, W.submit, CorpSubmissionWorkflowController)),
    ).toThrow(ForbiddenException);
  });
});

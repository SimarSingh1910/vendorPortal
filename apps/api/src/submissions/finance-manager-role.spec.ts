import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SubmissionWorkflowController } from './submission-workflow.controller';
import { AuditController } from '../audit/audit.controller';
import { UsersController } from '../users/users.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { ClinicsController } from '../clinics/clinics.controller';
import { ExpenseHeadsController } from '../expense-heads/expense-heads.controller';
import { ClinicExpenseHeadsController } from '../clinic-expense-heads/clinic-expense-heads.controller';
import type { RequestUser } from '../auth/request-user';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-08';

/**
 * Step 1 — FINANCE_MANAGER (formerly FINANCE_VIEWER) is a senior approver with
 * every FINANCE_ADMIN power EXCEPT user management. This suite proves both the
 * positive path (the manager can run the full finance workflow and reach the
 * finance screens) and the one guard that still separates the roles (users).
 */
describe('FINANCE_MANAGER authorization (Step 1)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let scope: ClinicScopeService;
  let fx: Fixtures;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        CycleService,
        WorkflowService,
        AuditService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    scope = moduleRef.get(ClinicScopeService);
    fx = makeFixtures({ prisma, cycle, workflow });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function openWithHeads(headCount: number) {
    const clinic = await fx.makeClinic();
    const heads = [];
    for (let i = 0; i < headCount; i += 1) heads.push(await fx.makeExpenseHead());
    if (heads.length > 0) await fx.mapHeads(clinic.id, heads.map((h) => h.id));
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    return { clinic, submission };
  }

  const reload = (id: string) => prisma.monthlySubmission.findUniqueOrThrow({ where: { id } });

  // ── Positive: the full finance path is open to a FINANCE_MANAGER ────────────

  it('drives the full finance path: open → approve (lock) → unlock → re-approve (re-lock)', async () => {
    const { submission } = await openWithHeads(2);
    await fx.driveToStatus(submission.id, SubmissionStatus.CLINIC_APPROVED);
    const fm = (await fx.makeUser(UserRole.FINANCE_MANAGER)).user;

    await workflow.financeOpenReview(submission.id, fm);
    let s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_REVIEW);
    expect(s.reviewStartedById).toBe(fm.id);

    await workflow.financeApprove(submission.id, fm);
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_APPROVED);
    expect(s.lockedAt).not.toBeNull();

    await runWithRequestContext({ user: { id: fm.id }, ip: '203.0.113.7' }, () =>
      workflow.financeUnlock(submission.id, fm, 'Manager correcting the utilities figure'),
    );
    s = await reload(submission.id);
    expect(s.status).toBe(SubmissionStatus.FINANCE_REVIEW);
    expect(s.lockedAt).toBeNull();
    expect(s.unlockedById).toBe(fm.id);

    // Re-approval re-locks — proving the manager owns the whole cycle.
    await workflow.financeApprove(submission.id, fm);
    expect((await reload(submission.id)).status).toBe(SubmissionStatus.FINANCE_APPROVED);
  });

  it('has org-wide clinic scope (so it reaches every clinic on dashboards/exports)', () => {
    const fm = { role: UserRole.FINANCE_MANAGER } as RequestUser;
    expect(scope.hasFullClinicAccess(fm)).toBe(true);
  });

  // ── RolesGuard: what the manager may and may not reach at the edge ──────────

  describe('RolesGuard edge enforcement', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = (role: UserRole, handler: unknown, cls: unknown): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        getHandler: () => handler,
        getClass: () => cls,
      }) as unknown as ExecutionContext;

    it('allows FINANCE_MANAGER on finance review/approval, audit and dashboards', () => {
      expect(
        guard.canActivate(
          ctx(
            UserRole.FINANCE_MANAGER,
            SubmissionWorkflowController.prototype.financeApprove,
            SubmissionWorkflowController,
          ),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(ctx(UserRole.FINANCE_MANAGER, AuditController.prototype.search, AuditController)),
      ).toBe(true);
      // Dashboards & exports carry no @Roles (service-side clinic-scoped) → allowed.
      // Exports follow the identical no-@Roles + clinic-scope path, covered by the
      // org-wide clinic-scope assertion above.
      expect(
        guard.canActivate(
          ctx(UserRole.FINANCE_MANAGER, DashboardController.prototype.status, DashboardController),
        ),
      ).toBe(true);
    });

    it('blocks FINANCE_MANAGER on user management (403) but allows FINANCE_ADMIN', () => {
      expect(() =>
        guard.canActivate(ctx(UserRole.FINANCE_MANAGER, UsersController.prototype.create, UsersController)),
      ).toThrow(ForbiddenException);
      expect(
        guard.canActivate(ctx(UserRole.FINANCE_ADMIN, UsersController.prototype.create, UsersController)),
      ).toBe(true);
    });

    it('blocks FINANCE_MANAGER on master-data WRITES (clinics/heads/mappings) but keeps READS', () => {
      // Writes are FINANCE_ADMIN-only (method-level @Roles overrides the class).
      const writes: [unknown, unknown][] = [
        [ClinicsController.prototype.create, ClinicsController],
        [ClinicsController.prototype.update, ClinicsController],
        [ClinicsController.prototype.deactivate, ClinicsController],
        [ExpenseHeadsController.prototype.create, ExpenseHeadsController],
        [ExpenseHeadsController.prototype.deactivate, ExpenseHeadsController],
        [ClinicExpenseHeadsController.prototype.set, ClinicExpenseHeadsController],
      ];
      for (const [handler, cls] of writes) {
        expect(() => guard.canActivate(ctx(UserRole.FINANCE_MANAGER, handler, cls))).toThrow(
          ForbiddenException,
        );
        expect(guard.canActivate(ctx(UserRole.FINANCE_ADMIN, handler, cls))).toBe(true);
      }

      // Reads stay open to the manager (other finance screens depend on them).
      expect(
        guard.canActivate(ctx(UserRole.FINANCE_MANAGER, ClinicsController.prototype.list, ClinicsController)),
      ).toBe(true);
      expect(
        guard.canActivate(
          ctx(UserRole.FINANCE_MANAGER, ExpenseHeadsController.prototype.list, ExpenseHeadsController),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(
          ctx(
            UserRole.FINANCE_MANAGER,
            ClinicExpenseHeadsController.prototype.list,
            ClinicExpenseHeadsController,
          ),
        ),
      ).toBe(true);
    });

    it('FINANCE_ADMIN still reaches everything — finance, audit and users', () => {
      expect(
        guard.canActivate(
          ctx(
            UserRole.FINANCE_ADMIN,
            SubmissionWorkflowController.prototype.financeApprove,
            SubmissionWorkflowController,
          ),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(ctx(UserRole.FINANCE_ADMIN, AuditController.prototype.search, AuditController)),
      ).toBe(true);
      expect(
        guard.canActivate(ctx(UserRole.FINANCE_ADMIN, UsersController.prototype.create, UsersController)),
      ).toBe(true);
    });
  });
});

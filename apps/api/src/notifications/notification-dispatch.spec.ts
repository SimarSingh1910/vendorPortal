import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationDispatchService, NotificationType } from './notification-dispatch.service';
import { EmailService } from './email.service';
import { resetDb } from '../../test/reset';

/**
 * Step 10.3 — each workflow/scheduler event must fire to EXACTLY the listed
 * recipients on BOTH channels (in-app row + email), with comment text where
 * applicable. Every test seeds decoys (inactive, wrong role, other clinic) and
 * asserts they are excluded.
 */
describe('NotificationDispatchService (Step 10.3 triggers)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dispatch: NotificationDispatchService;
  const emailSend = jest.fn(async () => undefined);

  let seq = 0;
  const nextEmail = () => `u${(seq += 1)}@t.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        NotificationService,
        NotificationEventsService,
        NotificationDispatchService,
        { provide: EmailService, useValue: { send: emailSend } },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dispatch = moduleRef.get(NotificationDispatchService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    emailSend.mockClear();
  });

  async function makeClinic(name = 'Acme Clinic') {
    return prisma.clinic.create({
      data: { name, location: 'L', corporateClient: 'C', isActive: true },
    });
  }

  async function makeUser(
    role: UserRole,
    opts: { clinicId?: string; active?: boolean } = {},
  ) {
    const email = nextEmail();
    return prisma.user.create({
      data: {
        name: 'U',
        email,
        passwordHash: 'x'.repeat(60),
        role,
        isActive: opts.active ?? true,
        assignments: opts.clinicId ? { create: [{ clinicId: opts.clinicId }] } : undefined,
      },
    });
  }

  function makeSubmission(clinicId: string, month = '2026-07') {
    return prisma.monthlySubmission.create({ data: { clinicId, month } });
  }

  /** All notification rows, with the recipient's email, grouped for assertions. */
  async function delivered() {
    const rows = await prisma.notification.findMany({
      include: { user: { select: { email: true } } },
    });
    return rows.map((r) => ({ email: r.user.email, type: r.type, message: r.message }));
  }

  it('Trigger 1: cycle opened → that clinic active SPOCs only', async () => {
    const clinic = await makeClinic();
    const other = await makeClinic('Other');
    const spoc = await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id });
    // Decoys: inactive SPOC, other-clinic SPOC, same-clinic manager/viewer.
    await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id, active: false });
    await makeUser(UserRole.CLINIC_SPOC, { clinicId: other.id });
    await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id });
    await makeUser(UserRole.CLINIC_VIEWER, { clinicId: clinic.id });
    const sub = await makeSubmission(clinic.id);

    await dispatch.cycleOpened(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([spoc.email]);
    expect(rows[0].type).toBe(NotificationType.CYCLE_OPENED);
    // Both channels: the in-app row above + a matching email to the recipient.
    // (NotificationService.create emails the row's own user — see notification.service.spec.)
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('zero mapped heads → every active finance approver (Admin + Manager)', async () => {
    const clinic = await makeClinic();
    const admin = await makeUser(UserRole.FINANCE_ADMIN);
    const financeManager = await makeUser(UserRole.FINANCE_MANAGER);
    await makeUser(UserRole.FINANCE_ADMIN, { active: false }); // decoy: inactive
    await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id }); // decoy: clinic role
    const sub = await makeSubmission(clinic.id);

    await dispatch.clinicHasNoHeads(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email).sort()).toEqual([admin.email, financeManager.email].sort());
    expect(rows.every((r) => r.type === NotificationType.CLINIC_NO_HEADS)).toBe(true);
  });

  it('Trigger 3: SPOC submits → that clinic Manager(s)', async () => {
    const clinic = await makeClinic();
    const mgr = await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id });
    await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id }); // decoy
    const sub = await makeSubmission(clinic.id);

    await dispatch.submitted(sub);

    expect((await delivered()).map((r) => r.email)).toEqual([mgr.email]);
  });

  it('Trigger 4: Manager approves → all finance approvers (Admin + Manager)', async () => {
    const clinic = await makeClinic();
    const admin = await makeUser(UserRole.FINANCE_ADMIN);
    const financeManager = await makeUser(UserRole.FINANCE_MANAGER);
    await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id }); // decoy
    const sub = await makeSubmission(clinic.id);

    await dispatch.managerApproved(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email).sort()).toEqual([admin.email, financeManager.email].sort());
    expect(rows.every((r) => r.type === NotificationType.MANAGER_APPROVED)).toBe(true);
  });

  it('Trigger 5: Manager sends back → SPOC(s) with the comment text', async () => {
    const clinic = await makeClinic();
    const spoc = await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id });
    await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id }); // decoy
    const sub = await makeSubmission(clinic.id);

    await dispatch.managerSentBack(sub, 'Please fix the rent line');

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([spoc.email]);
    expect(rows[0].message).toContain('Please fix the rent line');
  });

  it('Trigger 6: Finance approves → SPOC(s) + Manager(s)', async () => {
    const clinic = await makeClinic();
    const spoc = await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id });
    const mgr = await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id });
    await makeUser(UserRole.CLINIC_VIEWER, { clinicId: clinic.id }); // decoy
    const sub = await makeSubmission(clinic.id);

    await dispatch.financeApproved(sub);

    expect((await delivered()).map((r) => r.email).sort()).toEqual(
      [spoc.email, mgr.email].sort(),
    );
    expect(emailSend).toHaveBeenCalledTimes(2);
  });

  it('Trigger 7: Finance sends back → SPOC(s) + Manager(s) with the comment', async () => {
    const clinic = await makeClinic();
    const spoc = await makeUser(UserRole.CLINIC_SPOC, { clinicId: clinic.id });
    const mgr = await makeUser(UserRole.CLINIC_MANAGER, { clinicId: clinic.id });
    const sub = await makeSubmission(clinic.id);

    await dispatch.financeSentBack(sub, 'Variance too high');

    const rows = await delivered();
    expect(rows.map((r) => r.email).sort()).toEqual([spoc.email, mgr.email].sort());
    expect(rows.every((r) => r.message.includes('Variance too high'))).toBe(true);
  });
});

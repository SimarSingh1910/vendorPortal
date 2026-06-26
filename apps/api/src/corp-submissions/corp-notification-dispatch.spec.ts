import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { EmailService } from '../notifications/email.service';
import {
  CorpNotificationDispatchService,
  CorpNotificationType,
} from './corp-notification-dispatch.service';
import { resetDb } from '../../test/reset';

/**
 * Step C5.1 — each corporate workflow/scheduler event must fire to EXACTLY the
 * listed recipients on BOTH channels (in-app row + email), reusing the existing
 * NotificationService. Every test seeds decoys (inactive, wrong role, other
 * department) and asserts they are excluded.
 */
describe('CorpNotificationDispatchService (Step C5.1 triggers)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dispatch: CorpNotificationDispatchService;
  const emailSend = jest.fn(async () => undefined);

  let seq = 0;
  const nextEmail = () => `cn${(seq += 1)}@t.local`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        NotificationService,
        NotificationEventsService,
        CorpNotificationDispatchService,
        { provide: EmailService, useValue: { send: emailSend } },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    dispatch = moduleRef.get(CorpNotificationDispatchService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    emailSend.mockClear();
  });

  const makeDept = (name = 'Engineering') => prisma.corpDepartment.create({ data: { name } });

  async function makeUser(
    role: UserRole,
    opts: { departmentIds?: string[]; active?: boolean } = {},
  ) {
    return prisma.user.create({
      data: {
        name: 'U',
        email: nextEmail(),
        passwordHash: 'x'.repeat(60),
        role,
        isActive: opts.active ?? true,
        departmentAssignments: opts.departmentIds?.length
          ? { create: opts.departmentIds.map((departmentId) => ({ departmentId })) }
          : undefined,
      },
    });
  }

  const makeSubmission = (departmentId: string, month = '2026-07') =>
    prisma.corpMonthlySubmission.create({ data: { departmentId, month } });

  async function delivered() {
    const rows = await prisma.notification.findMany({
      include: { user: { select: { email: true } } },
    });
    return rows.map((r) => ({ email: r.user.email, type: r.type, message: r.message }));
  }

  it('cycle opened → that department’s active SPOCs only (incl. multi-dept SPOCs)', async () => {
    const dept = await makeDept();
    const other = await makeDept('Other');
    const spoc = await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] });
    const multiSpoc = await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id, other.id] });
    // Decoys: inactive SPOC, other-dept-only SPOC, viewer, the corp finance manager, admin.
    await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id], active: false });
    await makeUser(UserRole.DEPT_SPOC, { departmentIds: [other.id] });
    await makeUser(UserRole.DEPT_VIEWER, { departmentIds: [dept.id] });
    await makeUser(UserRole.CORP_FINANCE_MANAGER);
    await makeUser(UserRole.FINANCE_ADMIN);
    const sub = await makeSubmission(dept.id);

    await dispatch.cycleOpened(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email).sort()).toEqual([spoc.email, multiSpoc.email].sort());
    expect(rows.every((r) => r.type === CorpNotificationType.CORP_CYCLE_OPENED)).toBe(true);
    expect(emailSend).toHaveBeenCalledTimes(2);
  });

  it('zero active heads → Finance Admin(s) only (they own corp masters)', async () => {
    const dept = await makeDept();
    const admin = await makeUser(UserRole.FINANCE_ADMIN);
    await makeUser(UserRole.FINANCE_ADMIN, { active: false }); // decoy: inactive
    await makeUser(UserRole.CORP_FINANCE_MANAGER); // decoy: cannot edit masters
    await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] }); // decoy
    const sub = await makeSubmission(dept.id);

    await dispatch.deptHasNoHeads(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([admin.email]);
    expect(rows.every((r) => r.type === CorpNotificationType.CORP_DEPT_NO_HEADS)).toBe(true);
  });

  it('pre-cutoff reminder → that department’s active SPOCs', async () => {
    const dept = await makeDept();
    const spoc = await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] });
    await makeUser(UserRole.DEPT_VIEWER, { departmentIds: [dept.id] }); // decoy
    await makeUser(UserRole.CORP_FINANCE_MANAGER); // decoy
    const sub = await makeSubmission(dept.id);

    await dispatch.preCutoffReminder(sub, new Date('2026-07-25T02:30:00Z'));

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([spoc.email]);
    expect(rows[0].type).toBe(CorpNotificationType.CORP_PRE_CUTOFF_REMINDER);
  });

  it('SPOC submits → the Corporate Finance Manager(s) only (not the SPOC, not Admin)', async () => {
    const dept = await makeDept();
    const cfm = await makeUser(UserRole.CORP_FINANCE_MANAGER);
    await makeUser(UserRole.CORP_FINANCE_MANAGER, { active: false }); // decoy: inactive
    await makeUser(UserRole.FINANCE_ADMIN); // decoy: admin is not the submit recipient
    await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] }); // decoy
    const sub = await makeSubmission(dept.id);

    await dispatch.submitted(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([cfm.email]);
    expect(rows[0].type).toBe(CorpNotificationType.CORP_SUBMISSION_SUBMITTED);
  });

  it('approve → that department’s SPOCs only', async () => {
    const dept = await makeDept();
    const other = await makeDept('Other');
    const spoc = await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] });
    await makeUser(UserRole.DEPT_SPOC, { departmentIds: [other.id] }); // decoy: other dept
    await makeUser(UserRole.CORP_FINANCE_MANAGER); // decoy
    const sub = await makeSubmission(dept.id);

    await dispatch.approved(sub);

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([spoc.email]);
    expect(rows[0].type).toBe(CorpNotificationType.CORP_SUBMISSION_APPROVED);
  });

  it('send back → that department’s SPOCs with the comment text', async () => {
    const dept = await makeDept();
    const spoc = await makeUser(UserRole.DEPT_SPOC, { departmentIds: [dept.id] });
    await makeUser(UserRole.CORP_FINANCE_MANAGER); // decoy
    const sub = await makeSubmission(dept.id);

    await dispatch.sentBack(sub, 'Travel line looks high — please revise');

    const rows = await delivered();
    expect(rows.map((r) => r.email)).toEqual([spoc.email]);
    expect(rows[0].type).toBe(CorpNotificationType.CORP_SUBMISSION_SENT_BACK);
    expect(rows[0].message).toContain('Travel line looks high — please revise');
  });
});

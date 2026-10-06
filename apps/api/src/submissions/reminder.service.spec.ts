import { Test, type TestingModule } from '@nestjs/testing';
import { AuditAction, SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { runWithRequestContext } from '../audit/request-context';
import { AttachmentsService } from '../attachments/attachments.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import {
  NotificationDispatchService,
  NotificationType,
} from '../notifications/notification-dispatch.service';
import { EmailService } from '../notifications/email.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { CycleService } from './cycle.service';
import { WorkflowService } from './workflow.service';
import { ReminderService } from './reminder.service';
import { makeFixtures, type Fixtures } from '../../test/fixtures';
import { resetDb } from '../../test/reset';

const MONTH = '2026-09';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Finance "Send reminder" (dashboard): who gets it, what it says, once per IST day. */
describe('ReminderService (finance Send reminder)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let reminders: ReminderService;
  let dashboard: DashboardService;
  let fx: Fixtures;
  const emailSend = jest.fn<Promise<void>, [to: string, subject: string, body: string]>(
    async () => undefined,
  );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        AuditService,
        AttachmentsService,
        CorpDepartmentScopeService,
        CycleService,
        WorkflowService,
        NotificationService,
        NotificationEventsService,
        NotificationDispatchService,
        { provide: EmailService, useValue: { send: emailSend } },
        DashboardService,
        ReminderService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    reminders = moduleRef.get(ReminderService);
    dashboard = moduleRef.get(DashboardService);
    fx = makeFixtures({ prisma, cycle, workflow: moduleRef.get(WorkflowService) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    emailSend.mockClear();
  });

  /** An open clinic cycle with one mapped head. */
  async function openClinic(name = 'Pune') {
    const clinic = await fx.makeClinic({ name });
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, MONTH);
    return { clinic, submission };
  }

  /** Run as a logged-in finance user so the audit row carries the actor. */
  async function asFinance(name: string) {
    const finance = (await fx.makeUser(UserRole.FINANCE_MANAGER, [], { name })).user;
    return <T>(fn: () => Promise<T>) => runWithRequestContext({ user: { id: finance.id } }, fn);
  }

  const reminderAudits = (submissionId: string) =>
    prisma.auditLog.count({
      where: { entityId: submissionId, action: AuditAction.SUBMISSION_REMINDER_SENT },
    });

  it('SPOC must act → emails the active SPOCs + cluster managers (not inactive users, not finance)', async () => {
    const { clinic, submission } = await openClinic();
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id], { name: 'Asha' })).dbUser;
    const mgr = (await fx.makeUser(UserRole.CLINIC_MANAGER, [clinic.id], { name: 'Lalit' })).dbUser;
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id], { name: 'Gone', active: false });
    await fx.makeUser(UserRole.CLINIC_VIEWER, [clinic.id], { name: 'Viewer' });
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id]));

    expect(result.skipped).toEqual([]);
    expect(result.sent).toEqual([
      {
        submissionId: submission.id,
        clinicName: 'Pune',
        kind: 'SUBMISSION_PENDING',
        recipients: 2,
      },
    ]);
    const notes = await prisma.notification.findMany({
      where: { type: NotificationType.MANUAL_REMINDER },
    });
    expect(notes.map((n) => n.userId).sort()).toEqual([spoc.id, mgr.id].sort());
    expect(notes[0].message).toContain('has not been submitted yet');
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(emailSend.mock.calls.map((c) => c[0]).sort()).toEqual([spoc.email, mgr.email].sort());
    expect(emailSend.mock.calls[0][1]).toContain('submission pending');
    expect(await reminderAudits(submission.id)).toBe(1);
  });

  it('awaiting cluster-manager approval → emails only the cluster manager(s)', async () => {
    const { submission } = await openClinic();
    const actors = await fx.driveToStatus(submission.id, SubmissionStatus.SUBMITTED);
    emailSend.mockClear(); // ignore the workflow's own "submitted" email
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id]));

    expect(result.sent).toEqual([
      { submissionId: submission.id, clinicName: 'Pune', kind: 'APPROVAL_PENDING', recipients: 1 },
    ]);
    const notes = await prisma.notification.findMany({
      where: { type: NotificationType.MANUAL_REMINDER },
    });
    expect(notes.map((n) => n.userId)).toEqual([actors.manager.id]);
    expect(notes[0].message).toContain('waiting for your approval');
    expect(emailSend.mock.calls[0][1]).toContain('awaiting your approval');
  });

  it('a sent-back submission tells the SPOC to correct and resubmit', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    await prisma.monthlySubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.SENT_BACK_BY_FINANCE },
    });
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id]));

    expect(result.sent[0]?.kind).toBe('SUBMISSION_PENDING');
    const [note] = await prisma.notification.findMany({
      where: { type: NotificationType.MANUAL_REMINDER },
    });
    expect(note.message).toContain('sent back and still needs to be corrected');
  });

  it('nothing to chase once it is with Finance or approved; unknown ids are skipped', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    await prisma.monthlySubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.FINANCE_APPROVED },
    });
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id, 'no-such-id']));

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([
      {
        submissionId: submission.id,
        clinicName: 'Pune',
        reason: 'Nothing to remind (Finance Approved (Locked))',
      },
      { submissionId: 'no-such-id', clinicName: '', reason: 'Submission not found' },
    ]);
    expect(emailSend).not.toHaveBeenCalled();
    expect(await reminderAudits(submission.id)).toBe(0);
  });

  it('a clinic with nobody to email is skipped and NOT counted as reminded', async () => {
    const { submission } = await openClinic();
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id]));

    expect(result.skipped).toEqual([
      {
        submissionId: submission.id,
        clinicName: 'Pune',
        reason: 'No active SPOC or cluster manager assigned',
      },
    ]);
    expect(await reminderAudits(submission.id)).toBe(0);
  });

  it('once per clinic per IST day: a repeat is skipped with who sent it; the next day sends again', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    const prakash = await asFinance('Prakash');
    const meena = await asFinance('Meena');

    expect((await prakash(() => reminders.send([submission.id]))).sent).toHaveLength(1);
    const again = await meena(() => reminders.send([submission.id, submission.id]));
    expect(again.sent).toEqual([]);
    expect(again.skipped).toEqual([
      {
        submissionId: submission.id,
        clinicName: 'Pune',
        reason: 'Already reminded today by Prakash',
      },
    ]);
    expect(emailSend).toHaveBeenCalledTimes(1);

    const tomorrow = await meena(() =>
      reminders.send([submission.id], new Date(Date.now() + DAY_MS)),
    );
    expect(tomorrow.sent).toHaveLength(1);
    expect(await reminderAudits(submission.id)).toBe(2);
  });

  it('two finance users clicking at the same moment send exactly one reminder', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    const prakash = await asFinance('Prakash');
    const meena = await asFinance('Meena');

    const [a, b] = await Promise.all([
      prakash(() => reminders.send([submission.id])),
      meena(() => reminders.send([submission.id])),
    ]);

    expect(a.sent.length + b.sent.length).toBe(1);
    expect(a.skipped.length + b.skipped.length).toBe(1);
    expect(await reminderAudits(submission.id)).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('says "is due" on the cutoff day itself (IST) and "was due" after it', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    // Cutoff stored as midnight UTC (how the admin page saves it) = 05:30 IST on the 25th.
    await prisma.notificationConfig.create({
      data: {
        month: MONTH,
        monthStartNotifyDate: new Date('2026-09-01T00:00:00Z'),
        cutoffDate: new Date('2026-09-25T00:00:00Z'),
        preCutoffReminderDays: 3,
        varianceThresholdPercent: '10',
      },
    });
    const as = await asFinance('Prakash');

    // 10:00 IST on the cutoff day → still due today.
    await as(() => reminders.send([submission.id], new Date('2026-09-25T04:30:00Z')));
    // The next IST day → overdue (a new day, so not blocked by the once-a-day rule).
    await as(() => reminders.send([submission.id], new Date('2026-09-26T04:30:00Z')));

    const notes = await prisma.notification.findMany({
      where: { type: NotificationType.MANUAL_REMINDER },
      orderBy: { createdAt: 'asc' },
    });
    expect(notes.map((n) => n.message.match(/It (is|was) due by [^.]+/)?.[0])).toEqual([
      'It is due by 25 Sept 2026',
      'It was due by 25 Sept 2026',
    ]);
  });

  it('a status that moved on since the batch began is skipped, not sent a stale message', async () => {
    const { clinic, submission } = await openClinic();
    await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id]);
    const dispatch = moduleRef.get(NotificationDispatchService);
    const real = dispatch.reminderRecipients.bind(dispatch);
    // The clinic gets approved by Finance between the batch read and this item's claim.
    const spy = jest
      .spyOn(dispatch, 'reminderRecipients')
      .mockImplementationOnce(async (...args) => {
        await prisma.monthlySubmission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.FINANCE_APPROVED },
        });
        return real(...args);
      });
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([submission.id]));
    spy.mockRestore();

    expect(result.sent).toEqual([]);
    expect(result.skipped[0].reason).toBe(
      'Status changed to Finance Approved (Locked) — refresh and try again',
    );
    expect(emailSend).not.toHaveBeenCalled();
    expect(await reminderAudits(submission.id)).toBe(0);
  });

  it('one clinic failing does not sink the batch', async () => {
    const a = await openClinic('Alpha');
    const b = await openClinic('Bravo');
    await fx.makeUser(UserRole.CLINIC_SPOC, [a.clinic.id]);
    await fx.makeUser(UserRole.CLINIC_SPOC, [b.clinic.id]);
    const dispatch = moduleRef.get(NotificationDispatchService);
    const spy = jest
      .spyOn(dispatch, 'reminderRecipients')
      .mockRejectedValueOnce(new Error('db blip'));
    const as = await asFinance('Prakash');

    const result = await as(() => reminders.send([a.submission.id, b.submission.id]));
    spy.mockRestore();

    expect(result.skipped).toEqual([
      {
        submissionId: a.submission.id,
        clinicName: 'Alpha',
        reason: 'Could not send — please try again',
      },
    ]);
    expect(result.sent.map((s) => s.clinicName)).toEqual(['Bravo']);
    expect(await reminderAudits(a.submission.id)).toBe(0); // not claimed — can retry today
  });

  it('the status tiles show the last reminder (who + when) to finance, and nothing to clinic users', async () => {
    const { clinic, submission } = await openClinic();
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const as = await asFinance('Prakash');
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;

    const before = await dashboard.statusTracker(finance, MONTH);
    expect(before[0].lastReminderAt).toBeNull();

    await as(() => reminders.send([submission.id]));

    const [tile] = await dashboard.statusTracker(finance, MONTH);
    expect(tile.lastReminderByName).toBe('Prakash');
    expect(tile.lastReminderAt).not.toBeNull();
    const [own] = await dashboard.statusTracker(spoc, MONTH);
    expect(own.lastReminderAt).toBeNull();
    expect(own.lastReminderByName).toBeNull();
  });
});

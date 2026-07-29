import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ATTACHMENT_LIMITS, SubmissionStatus, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { ClinicExpenseHeadsService } from '../clinic-expense-heads/clinic-expense-heads.service';
import { AuditService } from '../audit/audit.service';
import { CycleService } from '../submissions/cycle.service';
import { WorkflowService } from '../submissions/workflow.service';
import { SubmissionCommentsService } from '../submissions/submission-comments.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { CorpCycleService } from '../corp-submissions/corp-cycle.service';
import { CorpWorkflowService } from '../corp-submissions/corp-workflow.service';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { CorpSubmissionCommentsService } from '../corp-submissions/corp-submission-comments.service';
import { Sec24AllocationService } from '../corp-submissions/sec24-allocation.service';
import { AttachmentsService, type UploadedFile } from './attachments.service';
import { makeFixtures, type Fixtures, expectStatus } from '../../test/fixtures';
import { makeCorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';

/**
 * Review-comment attachments (proof for overrides / send-backs). One shared
 * service and one shared table serve BOTH portals, so these cover the clinic path
 * in depth and assert the corporate path lands through the same code.
 */
describe('Comment attachments', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cycle: CycleService;
  let workflow: WorkflowService;
  let comments: SubmissionCommentsService;
  let attachments: AttachmentsService;
  let corpCycle: CorpCycleService;
  let corpWorkflow: CorpWorkflowService;
  let corpComments: CorpSubmissionCommentsService;
  let fx: Fixtures;
  let corpFx: ReturnType<typeof makeCorpFixtures>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ClinicScopeService,
        ClinicExpenseHeadsService,
        AuditService,
        CycleService,
        WorkflowService,
        SubmissionCommentsService,
        AttachmentsService,
        CorpDepartmentScopeService,
        CorpExpenseHeadsService,
        CorpCycleService,
        CorpWorkflowService,
        CorpSubmissionCommentsService,
        Sec24AllocationService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    cycle = moduleRef.get(CycleService);
    workflow = moduleRef.get(WorkflowService);
    comments = moduleRef.get(SubmissionCommentsService);
    attachments = moduleRef.get(AttachmentsService);
    corpCycle = moduleRef.get(CorpCycleService);
    corpWorkflow = moduleRef.get(CorpWorkflowService);
    corpComments = moduleRef.get(CorpSubmissionCommentsService);
    fx = makeFixtures({ prisma, cycle, workflow });
    corpFx = makeCorpFixtures(prisma, corpCycle);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    jest.restoreAllMocks();
  });

  /** A stand-in uploaded file. `bytes` fills a buffer of that exact length. */
  const file = (
    originalname: string,
    mimetype: string,
    bytes = 64,
  ): UploadedFile => ({
    originalname,
    mimetype,
    size: bytes,
    buffer: Buffer.alloc(bytes, 7),
  });

  /** Clinic submission sitting in the manager's review stage, with its manager. */
  async function clinicInReview() {
    const clinic = await fx.makeClinic();
    const head = await fx.makeExpenseHead();
    await fx.mapHeads(clinic.id, [head.id]);
    const { submission } = await cycle.openClinicCycle(clinic.id, '2026-07');
    const { manager } = await fx.driveToStatus(
      submission.id,
      SubmissionStatus.CLINIC_MANAGER_REVIEW,
    );
    return { clinic, submission, manager };
  }

  // ── Accepting valid uploads ─────────────────────────────────────────────────

  it('attaches allowed types to a send-back comment with uploader and timestamp', async () => {
    const { submission, manager } = await clinicInReview();

    await workflow.managerSendBack(submission.id, manager, 'Rent looks wrong — see the email', [
      file('landlord-email.eml', 'message/rfc822', 512),
      file('invoice.pdf', 'application/pdf', 2048),
      file('meter-photo.jpg', 'image/jpeg', 4096),
    ]);

    const thread = await comments.listForSubmission(submission.id, manager);
    const sentBack = thread.find((c) => c.comment.startsWith('Rent looks wrong'))!;
    expect(sentBack.attachments).toHaveLength(3);
    expect(sentBack.attachments.map((a) => a.fileName)).toEqual([
      'landlord-email.eml',
      'invoice.pdf',
      'meter-photo.jpg',
    ]);
    expect(sentBack.attachments.map((a) => a.sizeBytes)).toEqual([512, 2048, 4096]);
    // Provenance: who attached it and when.
    for (const a of sentBack.attachments) {
      expect(a.uploadedBy.id).toBe(manager.id);
      expect(new Date(a.uploadedAt).getTime()).toBeGreaterThan(0);
    }
  });

  it('a comment with no files simply has an empty attachment list', async () => {
    const { submission, manager } = await clinicInReview();
    await workflow.managerSendBack(submission.id, manager, 'no proof needed');
    const thread = await comments.listForSubmission(submission.id, manager);
    expect(thread.at(-1)!.attachments).toEqual([]);
  });

  // ── Server-side enforcement ─────────────────────────────────────────────────

  it('rejects a disallowed type — by MIME and by extension, independently', async () => {
    const { submission, manager } = await clinicInReview();

    // Outright disallowed type.
    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('payload.exe', 'application/x-msdownload'),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Script-bearing types stay out even though they are "documents".
    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('x.svg', 'image/svg+xml'),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('x.html', 'text/html'),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    // An allowed MIME carrying a mismatched extension is still rejected — a
    // renamed executable satisfies neither half of the check.
    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('payload.exe', 'application/pdf'),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.commentAttachment.count()).toBe(0);
  });

  it('rejects an oversize file, too many files, and an over-cap total', async () => {
    const { submission, manager } = await clinicInReview();
    const oneMb = 1024 * 1024;

    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('big.pdf', 'application/pdf', ATTACHMENT_LIMITS.maxFileBytes + 1),
      ]),
    ).rejects.toThrow(/limit is .* per file/);

    await expect(
      workflow.managerSendBack(
        submission.id,
        manager,
        'proof',
        Array.from({ length: ATTACHMENT_LIMITS.maxFiles + 1 }, (_, i) =>
          file(`p${i}.pdf`, 'application/pdf'),
        ),
      ),
    ).rejects.toThrow(/At most 5 files/);

    // Each file is individually legal (4 MB < 5 MB) but together they exceed the
    // 15 MB per-comment cap.
    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('a.pdf', 'application/pdf', 4 * oneMb),
        file('b.pdf', 'application/pdf', 4 * oneMb),
        file('c.pdf', 'application/pdf', 4 * oneMb),
        file('d.pdf', 'application/pdf', 4 * oneMb),
      ]),
    ).rejects.toThrow(/limit is .* per comment/);

    expect(await prisma.commentAttachment.count()).toBe(0);
  });

  it('rejects an empty file and sanitizes a path-bearing filename to its basename', async () => {
    const { submission, manager } = await clinicInReview();

    await expect(
      workflow.managerSendBack(submission.id, manager, 'proof', [
        file('empty.pdf', 'application/pdf', 0),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The client-supplied path is never trusted — only the basename is stored.
    await workflow.managerSendBack(submission.id, manager, 'proof', [
      { ...file('x.pdf', 'application/pdf'), originalname: 'C:\\Users\\bob\\secret\\proof.pdf' },
    ]);
    const stored = await prisma.commentAttachment.findFirstOrThrow();
    expect(stored.fileName).toBe('proof.pdf');
  });

  it('refuses files on a transition that writes no comment', async () => {
    const { submission, manager } = await clinicInReview();
    // Approve with files but NO comment: there is nothing for them to hang off,
    // so this fails loudly rather than silently discarding the proof.
    await expect(
      workflow.managerApprove(submission.id, manager, undefined, [
        file('proof.pdf', 'application/pdf'),
      ]),
    ).rejects.toThrow(/Attachments require a comment/);
    expect(await prisma.commentAttachment.count()).toBe(0);
  });

  // ── Atomicity ───────────────────────────────────────────────────────────────

  it('a rejected file leaves NO comment and no state change (files and comment are one unit)', async () => {
    const { submission, manager } = await clinicInReview();
    const before = await comments.listForSubmission(submission.id, manager);

    await expectStatus(
      workflow.managerSendBack(submission.id, manager, 'here is the proof', [
        file('payload.exe', 'application/x-msdownload'),
      ]),
      400,
    );

    // No comment, no attachment, and the submission never left review.
    expect(await comments.listForSubmission(submission.id, manager)).toHaveLength(before.length);
    expect(await prisma.commentAttachment.count()).toBe(0);
    const after = await prisma.monthlySubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(after.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
  });

  it('a failing attachment write rolls the comment back with it (no orphan comment)', async () => {
    const { submission, manager } = await clinicInReview();
    const before = await comments.listForSubmission(submission.id, manager);

    // Fail the attachment insert AFTER the comment row has been created inside the
    // transaction — the other direction of the both-or-neither guarantee.
    jest
      .spyOn(attachments, 'persist')
      .mockRejectedValueOnce(new Error('storage exploded'));

    await expect(
      workflow.managerSendBack(submission.id, manager, 'here is the proof', [
        file('invoice.pdf', 'application/pdf'),
      ]),
    ).rejects.toThrow('storage exploded');

    // The comment written moments earlier in the same transaction is gone.
    expect(await comments.listForSubmission(submission.id, manager)).toHaveLength(before.length);
    expect(await prisma.commentAttachment.count()).toBe(0);
    const after = await prisma.monthlySubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(after.status).toBe(SubmissionStatus.CLINIC_MANAGER_REVIEW);
  });

  // ── Download access control ─────────────────────────────────────────────────

  it('serves a download to an in-scope user and 403s a user outside the submission’s scope', async () => {
    const { clinic, submission, manager } = await clinicInReview();
    await workflow.managerSendBack(submission.id, manager, 'proof', [
      file('invoice.pdf', 'application/pdf', 128),
    ]);
    const row = await prisma.commentAttachment.findFirstOrThrow();

    // The clinic's own SPOC can download it.
    const spoc = (await fx.makeUser(UserRole.CLINIC_SPOC, [clinic.id])).user;
    const got = await attachments.download(row.id, spoc);
    expect(got.fileName).toBe('invoice.pdf');
    expect(got.mimeType).toBe('application/pdf');
    expect(got.data.length).toBe(128);

    // A SPOC of a DIFFERENT clinic cannot — same rule as the submission itself.
    const otherClinic = await fx.makeClinic();
    const outsider = (await fx.makeUser(UserRole.CLINIC_SPOC, [otherClinic.id])).user;
    await expect(attachments.download(row.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);

    // Finance is org-wide and may.
    const finance = (await fx.makeUser(UserRole.FINANCE_ADMIN)).user;
    await expect(attachments.download(row.id, finance)).resolves.toBeDefined();
  });

  it('downloading writes NO audit row; attaching is recorded on the comment’s own action', async () => {
    const { submission, manager } = await clinicInReview();
    await workflow.managerSendBack(submission.id, manager, 'proof', [
      file('invoice.pdf', 'application/pdf'),
      file('photo.png', 'image/png'),
    ]);

    // Adding the files shows up on the EXISTING send-back action — no new action.
    const auditRows = await prisma.auditLog.findMany({ where: { entityId: submission.id } });
    const sendBackRow = auditRows.find((r) => r.action === 'SUBMISSION_MANAGER_SEND_BACK')!;
    expect(sendBackRow.newValue).toMatchObject({
      attachmentCount: 2,
      attachmentFileNames: ['invoice.pdf', 'photo.png'],
    });
    expect(auditRows.some((r) => r.action.includes('ATTACHMENT'))).toBe(false);

    // Reading the bytes is a READ and must not write anything.
    const totalBefore = await prisma.auditLog.count();
    const row = await prisma.commentAttachment.findFirstOrThrow();
    await attachments.download(row.id, manager);
    await attachments.download(row.id, manager);
    expect(await prisma.auditLog.count()).toBe(totalBefore);
  });

  // ── Corporate portal, same shared path ──────────────────────────────────────

  it('corporate send-back attaches through the SAME shared service and scope-checks downloads', async () => {
    const dept = await corpFx.makeDept();
    const head = await corpFx.makeHead(dept.id);
    const code = await corpFx.makeBudgetCode(dept.id);
    const spoc = await corpFx.makeUser(UserRole.DEPT_SPOC, [dept.id]);
    const approver = await corpFx.makeUser(UserRole.CORP_FINANCE_MANAGER);
    const { submission } = await corpFx.openCycle(dept.id, '2026-07');
    expect(head.id).toBeDefined();

    await corpFx.valueAllHeads(submission.id, code.id, spoc.id);
    await corpWorkflow.submit(submission.id, spoc);
    await corpWorkflow.openReview(submission.id, approver);
    await corpWorkflow.sendBack(submission.id, approver, 'budget code is wrong — see attached', [
      file('approval-email.eml', 'message/rfc822', 256),
    ]);

    const thread = await corpComments.listForSubmission(submission.id, approver);
    const last = thread.at(-1)!;
    expect(last.attachments).toHaveLength(1);
    expect(last.attachments[0].fileName).toBe('approval-email.eml');

    // The row is parented to the CORP comment, not the clinic one.
    const row = await prisma.commentAttachment.findFirstOrThrow();
    expect(row.corpSubmissionCommentId).not.toBeNull();
    expect(row.submissionCommentId).toBeNull();

    // The department SPOC may download it; someone outside the department may not.
    await expect(attachments.download(row.id, spoc)).resolves.toBeDefined();
    const otherDept = await corpFx.makeDept();
    const outsider = await corpFx.makeUser(UserRole.DEPT_SPOC, [otherDept.id]);
    await expect(attachments.download(row.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── Immutability ────────────────────────────────────────────────────────────

  it('attachments are append-only: no service path edits or removes one after save', async () => {
    const { submission, manager } = await clinicInReview();
    await workflow.managerSendBack(submission.id, manager, 'proof', [
      file('invoice.pdf', 'application/pdf'),
    ]);

    // The service surface is create + read only — there is deliberately nothing
    // to call to change or drop a saved attachment.
    expect((attachments as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((attachments as unknown as Record<string, unknown>).remove).toBeUndefined();
    expect((attachments as unknown as Record<string, unknown>).delete).toBeUndefined();

    // A later comment on the same submission cannot touch the earlier proof.
    const before = await prisma.commentAttachment.findFirstOrThrow();
    await workflow.managerSendBack(submission.id, manager, 'second thought').catch(() => undefined);
    const after = await prisma.commentAttachment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.fileName).toBe(before.fileName);
    expect(after.uploadedAt).toEqual(before.uploadedAt);
    expect(Buffer.from(after.data)).toEqual(Buffer.from(before.data));
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  SubmissionStatus,
  UserRole,
  type ProvisionEntryInput,
  type SubmissionDetail,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicScopeService } from '../common/clinic-scope.service';
import { FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/request-user';
import { WorkflowService, isSpocEditable } from './workflow.service';
import { SubmissionsService } from './submissions.service';

const isLocked = (status: SubmissionStatus): boolean => status === SubmissionStatus.FINANCE_APPROVED;

/** Statuses in which the clinic manager owns the submission and may override values. */
const MANAGER_REVIEW_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CLINIC_MANAGER_REVIEW,
];

/** How an incoming edit is classified — drives the audit action and whether the
 * SPOC draft-save transition fires. */
type WriteKind = 'spoc' | 'manager-override' | 'finance-override';

/**
 * Provision data entry (Phase 6) + lock enforcement, manager override, and
 * finance override (Phase 8, BR-08). Three write paths share this service, all
 * writing the CANONICAL submission entries (single source of truth):
 *
 *  - SPOC: partial upsert while the submission is SPOC-actionable; moves it to
 *    DRAFT via the state machine. Editing a locked submission → 403; editing in
 *    any other non-actionable state → 409.
 *  - Clinic Manager (own clinic): may override values ONLY during their review
 *    stage (SUBMITTED / CLINIC_MANAGER_REVIEW), WITHOUT changing the status;
 *    every edit is audited (MANAGER_PROVISION_OVERRIDE). Editing outside that
 *    stage → 409, another clinic → 403, a locked submission → 403.
 *  - Finance approver (Admin or Manager): may edit at ANY status (including
 *    FINANCE_APPROVED/locked) WITHOUT changing the status; every edit is audited
 *    (PROVISION_EDIT_OVERRIDE).
 *
 * Both override paths preserve provenance: the upsert keeps enteredBy on the
 * original SPOC and stamps lastModifiedBy = the overriding actor.
 */
@Injectable()
export class ProvisionEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ClinicScopeService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly submissions: SubmissionsService,
  ) {}

  async saveEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
  ): Promise<SubmissionDetail> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, clinicId: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (!this.scope.canAccessClinic(user, submission.clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }

    const status = submission.status as SubmissionStatus;
    const isFinanceOverride = FINANCE_APPROVER_ROLES.includes(user.role);
    const isManager = user.role === UserRole.CLINIC_MANAGER;

    // Lock enforcement: a FINANCE_APPROVED submission is editable only by a
    // finance approver (Admin or Manager) as an override (BR-08). Everyone else → 403.
    if (isLocked(status) && !isFinanceOverride) {
      throw new ForbiddenException('This submission is locked');
    }
    // State rules per role:
    //  - finance: any status (lock handled above);
    //  - manager: only their review stage (SUBMITTED / CLINIC_MANAGER_REVIEW);
    //  - SPOC: only SPOC-actionable states.
    if (isManager) {
      if (!MANAGER_REVIEW_STATUSES.includes(status)) {
        throw new ConflictException(`Cannot edit a submission in ${status}`);
      }
    } else if (!isFinanceOverride && !isSpocEditable(status)) {
      throw new ConflictException(`Cannot edit a submission in ${status}`);
    }

    const kind: WriteKind = isFinanceOverride
      ? 'finance-override'
      : isManager
        ? 'manager-override'
        : 'spoc';

    if (items.length > 0) {
      await this.applyEntries(submissionId, user, items, kind, submission.clinicId);
    }

    if (kind === 'spoc') {
      // SPOC save: persisting progress moves NOT_STARTED / SENT_BACK_* → DRAFT.
      await this.workflow.saveDraft(submissionId, user);
    }
    // Manager/finance overrides never change the workflow status (a locked item
    // stays locked); the change is captured by the audit entry written above.

    return this.submissions.getDetail(submissionId, user);
  }

  /** Validate the targets, capture before/after, reconcile lines, then audit. */
  private async applyEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
    kind: WriteKind,
    clinicId: string,
  ): Promise<void> {
    // Load the referenced snapshots WITH their current lines — the reconciliation
    // key is the entry id, so we must know each head's existing lines.
    const snaps = await this.prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      select: {
        id: true,
        expenseHeadAllowsMultipleVendorsAtSnapshot: true,
        entries: {
          orderBy: { lineOrder: 'asc' },
          select: { id: true, amount: true, vendorName: true, productCode: true, note: true },
        },
      },
    });
    const snapById = new Map(snaps.map((s) => [s.id, s]));
    for (const item of items) {
      const snap = snapById.get(item.snapshotId);
      if (!snap) {
        throw new BadRequestException('Unknown snapshot head for this submission');
      }
      // Only a multi-vendor head may carry more than one line — a non-flagged head
      // is capped at a single line (data-driven from the snapshot flag).
      if (item.lines.length > 1 && !snap.expenseHeadAllowsMultipleVendorsAtSnapshot) {
        throw new BadRequestException('This expense head does not allow multiple vendor lines');
      }
      // Every provided entryId must be an existing line of THAT head (never another).
      const existingIds = new Set(snap.entries.map((e) => e.id));
      for (const line of item.lines) {
        if (line.entryId && !existingIds.has(line.entryId)) {
          throw new BadRequestException('Unknown line for this head');
        }
      }
    }

    // Before-image (per existing line) so the audit captures the change with line
    // identity. Covers every line of the referenced heads.
    const before = items.flatMap((item) =>
      snapById.get(item.snapshotId)!.entries.map((e) => ({
        entryId: e.id,
        snapshotId: item.snapshotId,
        amount: e.amount === null ? null : e.amount.toFixed(2),
        vendorName: e.vendorName,
        productCode: e.productCode,
      })),
    );

    // Only the SPOC owns the per-line note, vendor name and product code;
    // manager/finance value overrides leave all three untouched. Blank or
    // whitespace-only text is stored as null (never empty strings). The product
    // code is validated against the fixed set by the DTO.
    const writesSpocFields = kind === 'spoc';
    const trimOrNull = (v?: string): string | null => v?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const existing = snapById.get(item.snapshotId)!.entries;
        if (writesSpocFields) {
          // SPOC full reconcile: update lines with an id, create those without one,
          // delete existing lines the payload dropped (a removed vendor row).
          const keepIds = new Set(item.lines.map((l) => l.entryId).filter(Boolean) as string[]);
          const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
          if (toDelete.length > 0) {
            await tx.provisionEntry.deleteMany({ where: { id: { in: toDelete } } });
          }
          for (let i = 0; i < item.lines.length; i++) {
            const line = item.lines[i];
            const data = {
              lineOrder: i,
              amount: line.amount ?? null,
              note: trimOrNull(line.note),
              vendorName: trimOrNull(line.vendorName),
              productCode: trimOrNull(line.productCode),
            };
            if (line.entryId) {
              await tx.provisionEntry.update({
                where: { id: line.entryId },
                data: { ...data, lastModifiedById: user.id },
              });
            } else {
              await tx.provisionEntry.create({
                data: {
                  ...data,
                  submissionId,
                  snapshotId: item.snapshotId,
                  enteredById: user.id,
                  lastModifiedById: user.id,
                },
              });
            }
          }
        } else {
          // Manager/finance override: edit the amount of existing lines only —
          // never add, remove, or touch the SPOC's vendor/product/note.
          for (const line of item.lines) {
            if (!line.entryId) {
              throw new BadRequestException('An override must target an existing line');
            }
            await tx.provisionEntry.update({
              where: { id: line.entryId },
              data: { amount: line.amount ?? null, lastModifiedById: user.id },
            });
          }
        }
      }
    });

    // One audit row per save. A SPOC's normal save is PROVISION_SAVE (the
    // SAVE_DRAFT transition it triggers is intentionally NOT audited, avoiding a
    // double row); a manager review-stage override is MANAGER_PROVISION_OVERRIDE;
    // a finance (Admin/Manager) BR-08 override is PROVISION_EDIT_OVERRIDE.
    const auditAction =
      kind === 'finance-override'
        ? AuditAction.PROVISION_EDIT_OVERRIDE
        : kind === 'manager-override'
          ? AuditAction.MANAGER_PROVISION_OVERRIDE
          : AuditAction.PROVISION_SAVE;
    await this.audit.record({
      action: auditAction,
      entityType: 'MonthlySubmission',
      entityId: submissionId,
      clinicId,
      oldValue: before,
      newValue: items,
    });
  }
}

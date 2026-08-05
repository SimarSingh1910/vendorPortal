import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  MAX_VALUE_MINOR,
  QUANTITY_DECIMALS,
  RATE_DECIMALS,
  SubmissionStatus,
  UserRole,
  computeValueMinor,
  minorToDecimalString,
  sumMinor,
  toMinorUnits,
  type ProvisionEntryInput,
  type ProvisionParticularInput,
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

/**
 * One particular resolved to storage form: text normalised, rate/quantity scaled to
 * exact integer minor units, and `value` COMPUTED here. Nothing downstream of this
 * type can inject a value the server did not derive.
 */
interface ResolvedParticular {
  particularId?: string;
  particularName: string | null;
  rateMinor: bigint | null;
  quantityMinor: bigint | null;
  valueMinor: bigint | null;
  /** SPOC's optional free text on this row; blank/whitespace normalised to null. */
  remark: string | null;
}

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

  /**
   * Resolve one incoming particular to storage form, COMPUTING its value.
   *
   * This is the only place a value is ever produced on the write path: the DTO has
   * no `value` field, so whatever a client believes the total to be is structurally
   * incapable of reaching the database. Rate and quantity are converted to exact
   * integer minor units first, so the multiplication carries no float drift.
   */
  private resolveParticular(p: ProvisionParticularInput): ResolvedParticular {
    const valueMinor = computeValueMinor(p.rate ?? null, p.quantity ?? null);
    // rate × quantity can overflow DECIMAL(14,2) even when both inputs are within
    // their own column ranges — reject rather than let MySQL truncate the figure.
    if (valueMinor !== null && valueMinor > MAX_VALUE_MINOR) {
      throw new BadRequestException('Rate × quantity is too large for this particular');
    }
    return {
      particularId: p.particularId ?? undefined,
      particularName: p.particularName?.trim() || null,
      rateMinor: p.rate === null || p.rate === undefined ? null : toMinorUnits(p.rate, RATE_DECIMALS),
      quantityMinor:
        p.quantity === null || p.quantity === undefined
          ? null
          : toMinorUnits(p.quantity, QUANTITY_DECIMALS),
      valueMinor,
      remark: p.remark?.trim() || null,
    };
  }

  /**
   * The vendor line's amount: the exact sum of its particulars' COMPUTED values, or
   * null if any of them is still incomplete (a half-filled line has no trustworthy
   * subtotal — see sumMinor). Never derived from anything the client sent.
   */
  private lineAmount(particulars: ResolvedParticular[]): string | null {
    const total = sumMinor(particulars.map((p) => p.valueMinor));
    if (total === null) return null;
    if (total > MAX_VALUE_MINOR) {
      throw new BadRequestException('This vendor line total is too large');
    }
    return minorToDecimalString(total);
  }

  /** A resolved particular as Prisma column data (decimals passed as exact strings). */
  private particularData(p: ResolvedParticular, lineOrder: number) {
    return {
      lineOrder,
      particularName: p.particularName,
      rate: p.rateMinor === null ? null : minorToDecimalString(p.rateMinor, RATE_DECIMALS),
      quantity:
        p.quantityMinor === null ? null : minorToDecimalString(p.quantityMinor, QUANTITY_DECIMALS),
      value: p.valueMinor === null ? null : minorToDecimalString(p.valueMinor),
      remark: p.remark,
    };
  }

  /** Validate the targets, capture before/after, reconcile lines, then audit. */
  private async applyEntries(
    submissionId: string,
    user: RequestUser,
    items: ProvisionEntryInput[],
    kind: WriteKind,
    clinicId: string,
  ): Promise<void> {
    // Load the referenced snapshots WITH their current lines AND particulars — the
    // reconciliation keys are the entry id and the particular id, so we must know
    // each head's existing lines and each line's existing particulars.
    const snaps = await this.prisma.submissionExpenseHeadSnapshot.findMany({
      where: { submissionId },
      select: {
        id: true,
        expenseHeadAllowsMultipleVendorsAtSnapshot: true,
        entries: {
          orderBy: { lineOrder: 'asc' },
          select: {
            id: true,
            amount: true,
            vendorName: true,
            productCode: true,
            particulars: {
              orderBy: { lineOrder: 'asc' },
              select: {
                id: true,
                particularName: true,
                rate: true,
                quantity: true,
                value: true,
                // Needed by the override path, which must PRESERVE the SPOC's
                // remark while rewriting the row's rate/quantity/value.
                remark: true,
              },
            },
          },
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
      // Every provided entryId must be an existing line of THAT head (never another),
      // and every particularId an existing particular of THAT line (never another's).
      const entryById = new Map(snap.entries.map((e) => [e.id, e]));
      for (const line of item.lines) {
        if (line.entryId && !entryById.has(line.entryId)) {
          throw new BadRequestException('Unknown line for this head');
        }
        const ownParticularIds = new Set(
          line.entryId ? entryById.get(line.entryId)!.particulars.map((p) => p.id) : [],
        );
        for (const p of line.particulars) {
          if (p.particularId && !ownParticularIds.has(p.particularId)) {
            throw new BadRequestException('Unknown particular for this vendor line');
          }
        }
      }
    }

    // Before-image (per existing line, with its particulars) so the audit captures
    // the change with full line AND particular identity — a particular added,
    // edited or removed is visible in the old→new diff. Covers every line of the
    // referenced heads.
    const before = items.flatMap((item) =>
      snapById.get(item.snapshotId)!.entries.map((e) => ({
        entryId: e.id,
        snapshotId: item.snapshotId,
        amount: e.amount === null ? null : e.amount.toFixed(2),
        vendorName: e.vendorName,
        productCode: e.productCode,
        particulars: e.particulars.map((p) => ({
          particularId: p.id,
          particularName: p.particularName,
          rate: p.rate === null ? null : p.rate.toFixed(RATE_DECIMALS),
          quantity: p.quantity === null ? null : p.quantity.toFixed(QUANTITY_DECIMALS),
          value: p.value === null ? null : p.value.toFixed(2),
          // The per-particular remark rides the existing PROVISION_SAVE audit row:
          // it is part of the before-image, so an edited remark shows in old→new.
          remark: p.remark,
        })),
      })),
    );

    // Only the SPOC owns the per-particular remark and the line's vendor name and
    // product code; manager/finance value overrides leave all three untouched. Blank
    // or whitespace-only text is stored as null (never empty strings). The product
    // code is validated against the fixed set by the DTO.
    const writesSpocFields = kind === 'spoc';
    const trimOrNull = (v?: string): string | null => v?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const existing = snapById.get(item.snapshotId)!.entries;
        const existingById = new Map(existing.map((e) => [e.id, e]));

        if (writesSpocFields) {
          // SPOC full reconcile: update lines with an id, create those without one,
          // delete existing lines the payload dropped (a removed vendor row). A
          // deleted line takes its particulars with it (FK ON DELETE CASCADE).
          const keepIds = new Set(item.lines.map((l) => l.entryId).filter(Boolean) as string[]);
          const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
          if (toDelete.length > 0) {
            await tx.provisionEntry.deleteMany({ where: { id: { in: toDelete } } });
          }
          for (let i = 0; i < item.lines.length; i++) {
            const line = item.lines[i];
            const resolved = line.particulars.map((p) => this.resolveParticular(p));
            const data = {
              lineOrder: i,
              // DERIVED — recomputed from the particulars on every single save.
              amount: this.lineAmount(resolved),
              vendorName: trimOrNull(line.vendorName),
              productCode: trimOrNull(line.productCode),
            };
            let entryId: string;
            if (line.entryId) {
              await tx.provisionEntry.update({
                where: { id: line.entryId },
                data: { ...data, lastModifiedById: user.id },
              });
              entryId = line.entryId;
              // Reconcile this line's particulars the same way: drop the ones the
              // payload no longer carries, then update/create the rest.
              const keepParticularIds = new Set(
                resolved.map((p) => p.particularId).filter(Boolean) as string[],
              );
              const staleParticulars = existingById
                .get(line.entryId)!
                .particulars.filter((p) => !keepParticularIds.has(p.id))
                .map((p) => p.id);
              if (staleParticulars.length > 0) {
                await tx.entryParticular.deleteMany({ where: { id: { in: staleParticulars } } });
              }
            } else {
              const created = await tx.provisionEntry.create({
                data: {
                  ...data,
                  submissionId,
                  snapshotId: item.snapshotId,
                  enteredById: user.id,
                  lastModifiedById: user.id,
                },
              });
              entryId = created.id;
            }
            for (let j = 0; j < resolved.length; j++) {
              const p = resolved[j];
              if (p.particularId) {
                await tx.entryParticular.update({
                  where: { id: p.particularId },
                  data: this.particularData(p, j),
                });
              } else {
                await tx.entryParticular.create({
                  data: { ...this.particularData(p, j), entryId },
                });
              }
            }
          }
        } else {
          // Manager/finance override (BR-08): edit the PARTICULARS of existing
          // lines — the level values now live at — and let every total re-sum from
          // them. Reviewers may not add or remove lines/particulars, nor touch the
          // SPOC's vendor/product or a particular's remark. Because the line amount is recomputed here
          // exactly as on the SPOC path, an override can never leave a head amount
          // that contradicts its particulars.
          for (const line of item.lines) {
            if (!line.entryId) {
              throw new BadRequestException('An override must target an existing line');
            }
            const current = existingById.get(line.entryId)!;
            const byId = new Map(line.particulars.map((p) => [p.particularId, p]));
            // Start from what is stored and apply the override on top, so the
            // recomputed amount covers ALL of the line's particulars, not just the
            // subset the reviewer edited.
            // The remark is SPOC-owned, so it is always taken from what is STORED —
            // a reviewer cannot rewrite (or blank) the explanation, whether or not
            // their payload carries a `remark`.
            const resolved = current.particulars.map((stored) => {
              const patch = byId.get(stored.id);
              const base = patch
                ? this.resolveParticular({ ...patch, particularId: stored.id })
                : this.resolveParticular({
                    particularId: stored.id,
                    particularName: stored.particularName ?? undefined,
                    rate: stored.rate === null ? null : Number(stored.rate),
                    quantity: stored.quantity === null ? null : Number(stored.quantity),
                  });
              return { ...base, remark: stored.remark };
            });
            for (const p of line.particulars) {
              if (!p.particularId) {
                throw new BadRequestException('An override must target an existing particular');
              }
            }
            for (let j = 0; j < resolved.length; j++) {
              await tx.entryParticular.update({
                where: { id: resolved[j].particularId! },
                data: this.particularData(resolved[j], j),
              });
            }
            await tx.provisionEntry.update({
              where: { id: line.entryId },
              // DERIVED — recomputed from the (now overridden) particulars.
              data: { amount: this.lineAmount(resolved), lastModifiedById: user.id },
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

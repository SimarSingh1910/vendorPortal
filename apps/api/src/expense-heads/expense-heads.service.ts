import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ExpenseHead } from '@prisma/client';
import { AuditAction, SubmissionStatus, type ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateExpenseHeadDto } from './dto/create-expense-head.dto';
import { UpdateExpenseHeadDto } from './dto/update-expense-head.dto';

@Injectable()
export class ExpenseHeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateExpenseHeadDto): Promise<ExpenseHead> {
    const head = await this.prisma.expenseHead
      .create({ data: dto })
      .catch(this.rethrowDuplicateGlAccountNo);
    await this.audit.record({
      action: AuditAction.EXPENSE_HEAD_CREATE,
      entityType: 'ExpenseHead',
      entityId: head.id,
      newValue: dto,
    });
    return head;
  }

  list(status: ActiveFilter = 'all'): Promise<ExpenseHead[]> {
    const where =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    return this.prisma.expenseHead.findMany({
      where,
      orderBy: [{ glAccountNo: 'asc' }, { glAccountName: 'asc' }],
    });
  }

  async get(id: string): Promise<ExpenseHead> {
    const head = await this.prisma.expenseHead.findUnique({ where: { id } });
    if (!head) {
      throw new NotFoundException('Expense head not found');
    }
    return head;
  }

  async update(id: string, dto: UpdateExpenseHeadDto): Promise<ExpenseHead> {
    const before = await this.get(id);
    const togglingMultiVendor =
      dto.allowsMultipleVendors !== undefined &&
      dto.allowsMultipleVendors !== before.allowsMultipleVendors;

    // The master edit and the snapshot propagation move together — a half-applied
    // toggle would leave the admin's view and the SPOC's disagreeing.
    const { head, propagation } = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.expenseHead.update({ where: { id }, data: dto });
        const propagation = togglingMultiVendor
          ? await this.propagateMultiVendor(tx, id, dto.allowsMultipleVendors!)
          : null;
        return { head: updated, propagation };
      })
      .catch(this.rethrowDuplicateGlAccountNo);

    await this.audit.record({
      action: AuditAction.EXPENSE_HEAD_UPDATE,
      entityType: 'ExpenseHead',
      entityId: id,
      oldValue: {
        glAccountNo: before.glAccountNo,
        glAccountName: before.glAccountName,
        // Included so flipping multi-vendor on/off is visible in the trail as a
        // real old→new change rather than an unexplained newValue.
        allowsMultipleVendors: before.allowsMultipleVendors,
      },
      // Record what the toggle actually reached, so "why did last month change?"
      // (and "why didn't it?") is answerable from the trail alone.
      newValue: propagation ? { ...dto, snapshotPropagation: propagation } : dto,
    });
    return head;
  }

  /**
   * Apply a multi-vendor toggle to the head snapshots of months that are still
   * OPEN, so an admin's change reaches the SPOC who is entering data right now
   * rather than waiting for next month's cycle.
   *
   * Two rules keep this safe:
   *
   *  1. LOCKED MONTHS ARE NEVER TOUCHED. A finance-approved submission is frozen;
   *     its snapshot records the rules that applied when it was approved, and
   *     rewriting that would falsify an approved record.
   *
   *  2. TURNING IT OFF NEVER STRANDS DATA. If a SPOC has already entered several
   *     vendor lines against a head, switching it back to single-vendor would
   *     leave rows the UI can't render and the API would reject on the next save.
   *     Those snapshots keep multi-vendor until the month closes naturally; every
   *     other open month flips. Turning it ON is purely additive, so it always
   *     applies.
   */
  private async propagateMultiVendor(
    tx: Prisma.TransactionClient,
    expenseHeadId: string,
    allow: boolean,
  ): Promise<{ updated: number; skippedWithExistingLines: number }> {
    const openSnapshots = await tx.submissionExpenseHeadSnapshot.findMany({
      where: {
        expenseHeadId,
        submission: { status: { not: SubmissionStatus.FINANCE_APPROVED } },
      },
      select: { id: true, _count: { select: { entries: true } } },
    });

    // Turning ON is safe everywhere; turning OFF only where nothing would strand.
    const targets = allow
      ? openSnapshots
      : openSnapshots.filter((s) => s._count.entries <= 1);

    if (targets.length > 0) {
      await tx.submissionExpenseHeadSnapshot.updateMany({
        where: { id: { in: targets.map((s) => s.id) } },
        data: { expenseHeadAllowsMultipleVendorsAtSnapshot: allow },
      });
    }
    return {
      updated: targets.length,
      skippedWithExistingLines: openSnapshots.length - targets.length,
    };
  }

  /**
   * Map a unique-constraint violation on `glAccountNo` (Prisma P2002) to a clear
   * 409 so the admin UI can surface "code already exists" instead of a 500.
   */
  private rethrowDuplicateGlAccountNo(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | string | undefined)?.includes('glAccountNo')
    ) {
      throw new ConflictException('A head with this G/L Account No. already exists');
    }
    throw err;
  }

  /** Deactivation only flips isActive=false — it NEVER deletes the head or its history. */
  async setActive(id: string, isActive: boolean): Promise<ExpenseHead> {
    const before = await this.get(id);
    const head = await this.prisma.expenseHead.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      action: AuditAction.EXPENSE_HEAD_SET_ACTIVE,
      entityType: 'ExpenseHead',
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return head;
  }
}

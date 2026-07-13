import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ExpenseHead } from '@prisma/client';
import { AuditAction, type ActiveFilter } from '@portal/shared';
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
    const head = await this.prisma.expenseHead
      .update({ where: { id }, data: dto })
      .catch(this.rethrowDuplicateGlAccountNo);
    await this.audit.record({
      action: AuditAction.EXPENSE_HEAD_UPDATE,
      entityType: 'ExpenseHead',
      entityId: id,
      oldValue: { glAccountNo: before.glAccountNo, glAccountName: before.glAccountName },
      newValue: dto,
    });
    return head;
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

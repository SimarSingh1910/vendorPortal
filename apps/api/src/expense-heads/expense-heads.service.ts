import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExpenseHead } from '@prisma/client';
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
    const head = await this.prisma.expenseHead.create({ data: dto });
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
    return this.prisma.expenseHead.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
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
    const head = await this.prisma.expenseHead.update({ where: { id }, data: dto });
    await this.audit.record({
      action: AuditAction.EXPENSE_HEAD_UPDATE,
      entityType: 'ExpenseHead',
      entityId: id,
      oldValue: { name: before.name, category: before.category },
      newValue: dto,
    });
    return head;
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

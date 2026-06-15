import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExpenseHead } from '@prisma/client';
import type { ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseHeadDto } from './dto/create-expense-head.dto';
import { UpdateExpenseHeadDto } from './dto/update-expense-head.dto';

@Injectable()
export class ExpenseHeadsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExpenseHeadDto): Promise<ExpenseHead> {
    return this.prisma.expenseHead.create({ data: dto });
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
    await this.get(id);
    return this.prisma.expenseHead.update({ where: { id }, data: dto });
  }

  /** Deactivation only flips isActive=false — it NEVER deletes the head or its history. */
  async setActive(id: string, isActive: boolean): Promise<ExpenseHead> {
    await this.get(id);
    return this.prisma.expenseHead.update({ where: { id }, data: { isActive } });
  }
}

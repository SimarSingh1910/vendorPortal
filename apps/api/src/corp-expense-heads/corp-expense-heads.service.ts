import { Injectable, NotFoundException } from '@nestjs/common';
import type { CorpExpenseHead } from '@prisma/client';
import { AuditAction, type ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCorpExpenseHeadDto } from './dto/create-corp-expense-head.dto';
import { UpdateCorpExpenseHeadDto } from './dto/update-corp-expense-head.dto';

/**
 * Corporate expense-head master data (Step C1.1). Each head belongs to ONE
 * department and is NOT shared across departments (BR-C09) — unlike the clinic
 * ExpenseHead. Finance-Admin CRUD. Deactivation retains history (BR-C10): it
 * only flips isActive=false, never deletes. Every mutation records one audit
 * row; reads never audit.
 *
 * Routes are nested under a department, so each method takes the departmentId
 * and scopes by it — a head id from another department resolves to 404.
 */
@Injectable()
export class CorpExpenseHeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 404 if the parent department does not exist. */
  private async assertDepartment(departmentId: string): Promise<void> {
    const department = await this.prisma.corpDepartment.findUnique({
      where: { id: departmentId },
      select: { id: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
  }

  async create(departmentId: string, dto: CreateCorpExpenseHeadDto): Promise<CorpExpenseHead> {
    await this.assertDepartment(departmentId);
    const head = await this.prisma.corpExpenseHead.create({ data: { departmentId, ...dto } });
    await this.audit.record({
      action: AuditAction.CORP_EXPENSE_HEAD_CREATE,
      entityType: 'CorpExpenseHead',
      entityId: head.id,
      newValue: { departmentId, ...dto },
    });
    return head;
  }

  async list(departmentId: string, status: ActiveFilter = 'all'): Promise<CorpExpenseHead[]> {
    await this.assertDepartment(departmentId);
    const active =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    return this.prisma.corpExpenseHead.findMany({
      where: { departmentId, ...active },
      orderBy: { name: 'asc' },
    });
  }

  /** Resolve a head, scoped to its department (404 if it belongs elsewhere). */
  async get(departmentId: string, id: string): Promise<CorpExpenseHead> {
    const head = await this.prisma.corpExpenseHead.findFirst({ where: { id, departmentId } });
    if (!head) {
      throw new NotFoundException('Expense head not found');
    }
    return head;
  }

  async update(
    departmentId: string,
    id: string,
    dto: UpdateCorpExpenseHeadDto,
  ): Promise<CorpExpenseHead> {
    const before = await this.get(departmentId, id); // 404 if missing / wrong dept
    const head = await this.prisma.corpExpenseHead.update({ where: { id }, data: dto });
    await this.audit.record({
      action: AuditAction.CORP_EXPENSE_HEAD_UPDATE,
      entityType: 'CorpExpenseHead',
      entityId: id,
      oldValue: { name: before.name },
      newValue: dto,
    });
    return head;
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it NEVER
   * deletes the head or its history (provision entries stay) (BR-C10).
   */
  async setActive(departmentId: string, id: string, isActive: boolean): Promise<CorpExpenseHead> {
    const before = await this.get(departmentId, id);
    const head = await this.prisma.corpExpenseHead.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      action: AuditAction.CORP_EXPENSE_HEAD_SET_ACTIVE,
      entityType: 'CorpExpenseHead',
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return head;
  }
}

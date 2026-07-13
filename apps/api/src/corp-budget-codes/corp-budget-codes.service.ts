import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CorpBudgetCode } from '@prisma/client';
import { AuditAction, type ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCorpBudgetCodeDto } from './dto/create-corp-budget-code.dto';
import { UpdateCorpBudgetCodeDto } from './dto/update-corp-budget-code.dto';

/**
 * Corporate budget-code master data (Step C1.2). Each code belongs to ONE
 * department; `code` is unique within its department (@@unique[departmentId,
 * code]). Finance-Admin CRUD, no free text — every provision line later picks
 * one of its department's ACTIVE codes (BR-C01/BR-C02). Deactivation retains
 * history (BR-C10): it only flips isActive, never deletes. Every mutation
 * records one audit row; reads never audit.
 *
 * Routes are nested under a department, so each method takes the departmentId
 * and scopes by it — a code id from another department resolves to 404.
 */
@Injectable()
export class CorpBudgetCodesService {
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

  async create(departmentId: string, dto: CreateCorpBudgetCodeDto): Promise<CorpBudgetCode> {
    await this.assertDepartment(departmentId);
    let budgetCode: CorpBudgetCode;
    try {
      budgetCode = await this.prisma.corpBudgetCode.create({ data: { departmentId, ...dto } });
    } catch (err) {
      // Duplicate code within the same department (@@unique[departmentId, code]).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Budget code "${dto.code}" already exists in this department`);
      }
      throw err;
    }
    await this.audit.record({
      action: AuditAction.CORP_BUDGET_CODE_CREATE,
      entityType: 'CorpBudgetCode',
      entityId: budgetCode.id,
      newValue: { departmentId, ...dto },
    });
    return budgetCode;
  }

  /**
   * List a department's codes by lifecycle state. `status='active'` is the
   * provision-entry dropdown contract (BR-C02): only this department's active
   * codes, never another department's and never inactive ones.
   */
  async list(departmentId: string, status: ActiveFilter = 'all'): Promise<CorpBudgetCode[]> {
    await this.assertDepartment(departmentId);
    const active =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    return this.prisma.corpBudgetCode.findMany({
      where: { departmentId, ...active },
      orderBy: { code: 'asc' },
    });
  }

  /** Resolve a code, scoped to its department (404 if it belongs elsewhere). */
  async get(departmentId: string, id: string): Promise<CorpBudgetCode> {
    const budgetCode = await this.prisma.corpBudgetCode.findFirst({ where: { id, departmentId } });
    if (!budgetCode) {
      throw new NotFoundException('Budget code not found');
    }
    return budgetCode;
  }

  async update(
    departmentId: string,
    id: string,
    dto: UpdateCorpBudgetCodeDto,
  ): Promise<CorpBudgetCode> {
    const before = await this.get(departmentId, id); // 404 if missing / wrong dept
    let budgetCode: CorpBudgetCode;
    try {
      budgetCode = await this.prisma.corpBudgetCode.update({ where: { id }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Budget code "${dto.code}" already exists in this department`);
      }
      throw err;
    }
    await this.audit.record({
      action: AuditAction.CORP_BUDGET_CODE_UPDATE,
      entityType: 'CorpBudgetCode',
      entityId: id,
      oldValue: { code: before.code, description: before.description },
      newValue: dto,
    });
    return budgetCode;
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it NEVER
   * deletes the code or its history (provision entries stay) (BR-C10). An
   * inactive code drops out of the entry dropdown but remains on past lines.
   */
  async setActive(departmentId: string, id: string, isActive: boolean): Promise<CorpBudgetCode> {
    const before = await this.get(departmentId, id);
    const budgetCode = await this.prisma.corpBudgetCode.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      action: AuditAction.CORP_BUDGET_CODE_SET_ACTIVE,
      entityType: 'CorpBudgetCode',
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return budgetCode;
  }
}

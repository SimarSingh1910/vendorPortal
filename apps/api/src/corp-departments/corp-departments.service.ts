import { Injectable, NotFoundException } from '@nestjs/common';
import type { CorpDepartment } from '@prisma/client';
import { AuditAction, type ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCorpDepartmentDto } from './dto/create-corp-department.dto';
import { UpdateCorpDepartmentDto } from './dto/update-corp-department.dto';

/**
 * Corporate department master data (Step C1.1). Finance-Admin CRUD. Departments
 * are deactivated, never deleted — history (heads, budget codes, submissions,
 * assignments) is retained (BR-C10). Every mutation records ONE audit row; reads
 * never audit. Corporate masters are not clinic-scoped, so audit rows omit
 * clinicId.
 */
@Injectable()
export class CorpDepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCorpDepartmentDto): Promise<CorpDepartment> {
    const department = await this.prisma.corpDepartment.create({ data: dto });
    await this.audit.record({
      action: AuditAction.CORP_DEPARTMENT_CREATE,
      entityType: 'CorpDepartment',
      entityId: department.id,
      newValue: dto,
    });
    return department;
  }

  list(status: ActiveFilter = 'all'): Promise<CorpDepartment[]> {
    const where =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    return this.prisma.corpDepartment.findMany({ where, orderBy: { name: 'asc' } });
  }

  async get(id: string): Promise<CorpDepartment> {
    const department = await this.prisma.corpDepartment.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async update(id: string, dto: UpdateCorpDepartmentDto): Promise<CorpDepartment> {
    const before = await this.get(id); // 404 if missing
    const department = await this.prisma.corpDepartment.update({ where: { id }, data: dto });
    await this.audit.record({
      action: AuditAction.CORP_DEPARTMENT_UPDATE,
      entityType: 'CorpDepartment',
      entityId: id,
      oldValue: { name: before.name, type: before.type },
      newValue: dto,
    });
    return department;
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it NEVER
   * deletes the department or its history (heads, budget codes, submissions and
   * assignments all stay) (BR-C10).
   */
  async setActive(id: string, isActive: boolean): Promise<CorpDepartment> {
    const before = await this.get(id);
    const department = await this.prisma.corpDepartment.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      action: AuditAction.CORP_DEPARTMENT_SET_ACTIVE,
      entityType: 'CorpDepartment',
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return department;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Clinic } from '@prisma/client';
import { AuditAction, type ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClinicDto): Promise<Clinic> {
    const clinic = await this.prisma.clinic.create({ data: dto });
    await this.audit.record({
      action: AuditAction.CLINIC_CREATE,
      entityType: 'Clinic',
      entityId: clinic.id,
      clinicId: clinic.id,
      newValue: dto,
    });
    return clinic;
  }

  list(status: ActiveFilter = 'all'): Promise<Clinic[]> {
    const where =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    return this.prisma.clinic.findMany({ where, orderBy: { name: 'asc' } });
  }

  async get(id: string): Promise<Clinic> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }
    return clinic;
  }

  async update(id: string, dto: UpdateClinicDto): Promise<Clinic> {
    const before = await this.get(id); // 404 if missing
    const clinic = await this.prisma.clinic.update({ where: { id }, data: dto });
    await this.audit.record({
      action: AuditAction.CLINIC_UPDATE,
      entityType: 'Clinic',
      entityId: id,
      clinicId: id,
      oldValue: {
        name: before.name,
        location: before.location,
        corporateClient: before.corporateClient,
      },
      newValue: dto,
    });
    return clinic;
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it NEVER
   * deletes the clinic or its history (assignments, submissions, mappings stay).
   */
  async setActive(id: string, isActive: boolean): Promise<Clinic> {
    const before = await this.get(id);
    const clinic = await this.prisma.clinic.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      action: AuditAction.CLINIC_SET_ACTIVE,
      entityType: 'Clinic',
      entityId: id,
      clinicId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return clinic;
  }
}

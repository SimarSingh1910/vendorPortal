import { Injectable, NotFoundException } from '@nestjs/common';
import type { Clinic } from '@prisma/client';
import type { ActiveFilter } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';

@Injectable()
export class ClinicsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClinicDto): Promise<Clinic> {
    return this.prisma.clinic.create({ data: dto });
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
    await this.get(id); // 404 if missing
    return this.prisma.clinic.update({ where: { id }, data: dto });
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it NEVER
   * deletes the clinic or its history (assignments, submissions, mappings stay).
   */
  async setActive(id: string, isActive: boolean): Promise<Clinic> {
    await this.get(id);
    return this.prisma.clinic.update({ where: { id }, data: { isActive } });
  }
}

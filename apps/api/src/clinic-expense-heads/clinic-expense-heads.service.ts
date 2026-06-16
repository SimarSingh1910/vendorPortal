import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MappedExpenseHead } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ClinicExpenseHeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertClinic(clinicId: string): Promise<void> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true },
    });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }
  }

  /**
   * The heads that currently APPLY to a clinic: mapping active AND head active.
   * This is exactly what the provision form renders — empty until heads are
   * explicitly mapped. No "all by default".
   */
  async listMapped(clinicId: string): Promise<MappedExpenseHead[]> {
    await this.assertClinic(clinicId);
    const rows = await this.prisma.clinicExpenseHead.findMany({
      where: { clinicId, isActive: true, expenseHead: { isActive: true } },
      include: { expenseHead: true },
      orderBy: [{ expenseHead: { category: 'asc' } }, { expenseHead: { name: 'asc' } }],
    });
    return rows.map((row) => ({
      mappingId: row.id,
      expenseHeadId: row.expenseHeadId,
      name: row.expenseHead.name,
      category: row.expenseHead.category,
    }));
  }

  /**
   * Replace the active mapping set with exactly `expenseHeadIds`. Heads removed
   * from the set are DEACTIVATED (isActive=false), never deleted — preserving
   * history. This only ever touches ClinicExpenseHead rows; it never reads or
   * writes SubmissionExpenseHeadSnapshot, so existing submissions' snapshots are
   * unaffected by a mapping change.
   */
  async setMappings(clinicId: string, expenseHeadIds: string[]): Promise<MappedExpenseHead[]> {
    await this.assertClinic(clinicId);
    const desired = [...new Set(expenseHeadIds)];

    if (desired.length > 0) {
      const found = await this.prisma.expenseHead.findMany({
        where: { id: { in: desired } },
        select: { id: true },
      });
      if (found.length !== desired.length) {
        throw new BadRequestException('One or more expense head ids are invalid');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Deactivate currently-active mappings that are no longer desired.
      await tx.clinicExpenseHead.updateMany({
        where:
          desired.length > 0
            ? { clinicId, isActive: true, expenseHeadId: { notIn: desired } }
            : { clinicId, isActive: true },
        data: { isActive: false },
      });
      // Upsert each desired mapping as active (re-activates a previously removed one).
      for (const expenseHeadId of desired) {
        await tx.clinicExpenseHead.upsert({
          where: { clinicId_expenseHeadId: { clinicId, expenseHeadId } },
          update: { isActive: true },
          create: { clinicId, expenseHeadId, isActive: true },
        });
      }
    });

    await this.audit.record({
      action: 'CLINIC_MAPPINGS_SET',
      entityType: 'Clinic',
      entityId: clinicId,
      clinicId,
      newValue: { expenseHeadIds: desired },
    });

    return this.listMapped(clinicId);
  }
}

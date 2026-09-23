import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Clinic } from '@prisma/client';
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
        accLocationCode: before.accLocationCode,
        customerCode: before.customerCode,
        customerName: before.customerName,
      },
      newValue: dto,
    });
    return clinic;
  }

  /**
   * Deactivate/activate. Deactivation only flips isActive=false — it never
   * touches the clinic's history (assignments, submissions, mappings stay).
   * It is the fallback whenever remove() refuses: a clinic that carries history
   * can only ever be deactivated.
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

  /**
   * SAFE DELETE — hard-deletes a clinic ONLY when it carries no history.
   * MonthlySubmission.clinicId is ON DELETE CASCADE, so an unchecked delete would
   * silently destroy every submission, snapshot, provision entry, comment and
   * attachment for the clinic; the 409 below is the only thing standing between
   * an admin click and that loss. A clinic that blocks can still be deactivated.
   *
   * Deleted with it (no history, cheap to recreate): ClinicExpenseHead mappings
   * and UserClinicAssignment rows, both via DB cascade. AuditLog rows carry
   * clinicId with NO foreign key and are untouched — the history of the clinic
   * outlives the clinic row. Because the assignment cascade is an assignment
   * change, every user who held the clinic has their sessions invalidated.
   */
  async remove(id: string): Promise<Clinic> {
    const clinic = await this.get(id); // 404 if missing

    // Blockers, audit row and the delete share one transaction, so the audit row
    // — the only surviving record of the clinic — cannot fail to commit after the
    // row is already gone.
    await this.prisma.$transaction(async (tx) => {
      // A transaction alone does NOT make the counts race-free: under MySQL's
      // default REPEATABLE READ the counts are snapshot reads while the DELETE is
      // a current read, so a submission committed in between would be invisible
      // to the count and still cascaded away. The X lock on the clinic row closes
      // that window: InnoDB takes a shared lock on the parent row when FK-checking
      // an INSERT into MonthlySubmission or UserClinicAssignment (the nightly
      // SchedulerService cycle-open is one such writer), so both block until this
      // delete commits and then fail with a clean FK error instead of vanishing.
      await tx.$queryRaw`SELECT id FROM \`Clinic\` WHERE id = ${id} FOR UPDATE`;

      const submissions = await tx.monthlySubmission.count({ where: { clinicId: id } });
      if (submissions > 0) {
        throw new ConflictException(
          `This clinic has ${submissions} monthly submission${submissions === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead.`,
        );
      }
      // Users whose ONLY clinic is this one: the cascade would leave them with
      // zero clinics, which resolveClinicIds forbids for every clinic role.
      const strandedUsers = await tx.user.count({
        where: {
          assignments: { some: { clinicId: id } },
          NOT: { assignments: { some: { clinicId: { not: id } } } },
        },
      });
      if (strandedUsers > 0) {
        throw new ConflictException(
          `This clinic is the only clinic assigned to ${strandedUsers} user${strandedUsers === 1 ? '' : 's'} and cannot be deleted. Reassign those users to another clinic first.`,
        );
      }

      // Everyone left holding this clinic keeps it in their access token's
      // clinicIds claim otherwise: JwtAccessGuard reads scope from the token and
      // relies on every assignment change bumping tokenVersion. Same two writes
      // as AuthService.invalidateUserSessions, done here so they commit with the
      // cascade instead of after it.
      const affected = await tx.userClinicAssignment.findMany({
        where: { clinicId: id },
        select: { userId: true },
      });

      await this.audit.record(
        {
          action: AuditAction.CLINIC_DELETE,
          entityType: 'Clinic',
          entityId: id,
          clinicId: id,
          oldValue: {
            name: clinic.name,
            accLocationCode: clinic.accLocationCode,
            customerCode: clinic.customerCode,
            customerName: clinic.customerName,
            isActive: clinic.isActive,
          },
        },
        tx,
      );

      try {
        await tx.clinic.delete({ where: { id } });
      } catch (err) {
        // Another admin deleted the same row between get() and here.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new NotFoundException('Clinic not found');
        }
        throw err;
      }

      const userIds = affected.map((a) => a.userId);
      if (userIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: userIds } },
          data: { tokenVersion: { increment: 1 } },
        });
        await tx.refreshToken.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    return clinic;
  }
}

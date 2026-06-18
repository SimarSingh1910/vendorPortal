import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, CLINIC_ROLES, UserRole, type ActiveFilter, type AdminUser } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type UserWithAssignments = Prisma.UserGetPayload<{ include: { assignments: true } }>;

function toAdminUser(user: UserWithAssignments): AdminUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    isActive: user.isActive,
    clinicIds: user.assignments.map((a) => a.clinicId),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private isClinicRole(role: UserRole): boolean {
    return (CLINIC_ROLES as readonly UserRole[]).includes(role);
  }

  /**
   * Resolve and validate the clinic assignment for a user (Step 2 — exactly one
   * clinic per clinic-role user; none for finance roles):
   *  - Finance roles oversee every clinic and must carry NO assignment. An
   *    explicit non-empty clinic list is rejected (400); an omitted/empty list
   *    resolves to none (so promoting a clinic user to finance clears it).
   *  - Clinic roles (Manager / SPOC / Viewer) must resolve to exactly ONE clinic
   *    (0 or >1 → 400). On update, an omitted list falls back to the current
   *    assignment so a legacy multi-clinic row is surfaced as an error rather
   *    than silently trimmed.
   * Note: one clinic per user, but a clinic may still have many users.
   */
  private resolveClinicIds(
    role: UserRole,
    provided: string[] | undefined,
    current?: string[],
  ): string[] {
    if (!this.isClinicRole(role)) {
      if (provided && provided.length > 0) {
        throw new BadRequestException(
          'Finance-role users oversee all clinics and cannot be assigned to a clinic',
        );
      }
      return [];
    }
    const target = [...new Set(provided ?? current ?? [])];
    if (target.length !== 1) {
      throw new BadRequestException(
        'Clinic Manager, SPOC and Viewer users must be assigned to exactly one clinic',
      );
    }
    return target;
  }

  private async assertClinicsExist(clinicIds: string[]): Promise<void> {
    if (clinicIds.length === 0) return;
    const found = await this.prisma.clinic.findMany({
      where: { id: { in: clinicIds } },
      select: { id: true },
    });
    if (found.length !== clinicIds.length) {
      throw new BadRequestException('One or more clinic ids are invalid');
    }
  }

  async list(status: ActiveFilter = 'all'): Promise<AdminUser[]> {
    const where =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    const users = await this.prisma.user.findMany({
      where,
      include: { assignments: true },
      orderBy: { name: 'asc' },
    });
    return users.map(toAdminUser);
  }

  async get(id: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { assignments: true } });
    if (!user) throw new NotFoundException('User not found');
    return toAdminUser(user);
  }

  async create(dto: CreateUserDto): Promise<AdminUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const clinicIds = this.resolveClinicIds(dto.role, dto.clinicIds);
    await this.assertClinicsExist(clinicIds);
    const passwordHash = await this.auth.hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        assignments: { create: clinicIds.map((clinicId) => ({ clinicId })) },
      },
      include: { assignments: true },
    });
    await this.audit.record({
      action: AuditAction.USER_CREATE,
      entityType: 'User',
      entityId: user.id,
      newValue: { name: dto.name, email: dto.email, role: dto.role, clinicIds },
    });
    // New user has no sessions yet — nothing to invalidate.
    return toAdminUser(user);
  }

  async update(id: string, dto: UpdateUserDto, requesterId: string): Promise<AdminUser> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      include: { assignments: true },
    });
    if (!current) throw new NotFoundException('User not found');

    const newRole = dto.role ?? (current.role as UserRole);
    const roleChanged = dto.role !== undefined && dto.role !== current.role;

    // Self-protection: an admin can't demote themselves out of FINANCE_ADMIN
    // (avoids locking the last admin out mid-session).
    if (requesterId === id && roleChanged && current.role === UserRole.FINANCE_ADMIN) {
      throw new BadRequestException('You cannot change your own role');
    }

    const currentClinicIds = current.assignments.map((a) => a.clinicId);
    let targetClinicIds = currentClinicIds;
    let assignmentsTouched = false;
    if (dto.clinicIds !== undefined || roleChanged) {
      targetClinicIds = this.resolveClinicIds(newRole, dto.clinicIds, currentClinicIds);
      await this.assertClinicsExist(targetClinicIds);
      assignmentsTouched = true;
    }
    const assignmentsChanged = assignmentsTouched && !sameSet(currentClinicIds, targetClinicIds);
    const passwordChanged = dto.password !== undefined;

    const userData: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) userData.name = dto.name;
    if (dto.role !== undefined) userData.role = dto.role;
    if (passwordChanged) userData.passwordHash = await this.auth.hashPassword(dto.password!);

    const user = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id }, data: userData });
      }
      if (assignmentsChanged) {
        await tx.userClinicAssignment.deleteMany({ where: { userId: id } });
        if (targetClinicIds.length > 0) {
          await tx.userClinicAssignment.createMany({
            data: targetClinicIds.map((clinicId) => ({ userId: id, clinicId })),
          });
        }
      }
      return tx.user.findUniqueOrThrow({ where: { id }, include: { assignments: true } });
    });

    // Immediate effect: any security-relevant change kills outstanding sessions.
    if (roleChanged || assignmentsChanged || passwordChanged) {
      await this.auth.invalidateUserSessions(id);
    }

    await this.audit.record({
      action: AuditAction.USER_UPDATE,
      entityType: 'User',
      entityId: id,
      // Never log password material — only whether it changed.
      oldValue: { role: current.role, clinicIds: currentClinicIds },
      newValue: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        role: newRole,
        clinicIds: targetClinicIds,
        passwordChanged,
      },
    });
    return toAdminUser(user);
  }

  /** Deactivate/activate. Always invalidates sessions; never deletes the user (audit history preserved). */
  async setActive(id: string, isActive: boolean, requesterId: string): Promise<AdminUser> {
    const current = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new NotFoundException('User not found');
    if (requesterId === id && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      include: { assignments: true },
    });
    await this.auth.invalidateUserSessions(id);
    await this.audit.record({
      action: AuditAction.USER_SET_ACTIVE,
      entityType: 'User',
      entityId: id,
      newValue: { isActive },
    });
    return toAdminUser(user);
  }
}

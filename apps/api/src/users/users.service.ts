import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  CLINIC_ROLES,
  DEPT_SCOPED_ROLES,
  PortalTab,
  rolesForTab,
  UserRole,
  type ActiveFilter,
  type AdminUser,
} from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type UserWithAssignments = Prisma.UserGetPayload<{
  include: { assignments: true; departmentAssignments: true };
}>;

/** Always load both assignment sets so AdminUser carries clinicIds + departmentIds. */
const userInclude = { assignments: true, departmentAssignments: true } as const;

function toAdminUser(user: UserWithAssignments): AdminUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    isActive: user.isActive,
    clinicIds: user.assignments.map((a) => a.clinicId),
    departmentIds: user.departmentAssignments.map((a) => a.departmentId),
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
   * Resolve and validate the clinic assignment for a user (one or more clinics
   * per clinic-role user; none for finance roles):
   *  - Finance roles oversee every clinic and must carry NO assignment. An
   *    explicit non-empty clinic list is rejected (400); an omitted/empty list
   *    resolves to none (so promoting a clinic user to finance clears it).
   *  - Clinic roles (Manager / SPOC / Viewer) must resolve to AT LEAST ONE
   *    clinic (0 → 400); duplicates are de-duplicated. On update, an omitted
   *    list falls back to the current assignment.
   * Note: a user may cover several clinics, and a clinic may have many users.
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
    if (target.length === 0) {
      throw new BadRequestException(
        'Cluster Manager, SPOC and Viewer users must be assigned to at least one clinic',
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

  private isDeptRole(role: UserRole): boolean {
    return (DEPT_SCOPED_ROLES as readonly UserRole[]).includes(role);
  }

  /**
   * Resolve and validate the DEPARTMENT assignment for a corporate user — the
   * mirror of resolveClinicIds, but department-scoped roles (Dept SPOC/Viewer)
   * may hold MULTIPLE departments:
   *  - Non-department roles (incl. CORP_FINANCE_MANAGER, which auto-sees every
   *    department) must carry NO assignment. An explicit non-empty list is
   *    rejected (400); an omitted/empty list resolves to none (so changing a
   *    Dept SPOC to CORP_FINANCE_MANAGER clears it).
   *  - Dept SPOC/Viewer must resolve to AT LEAST ONE department (0 → 400);
   *    duplicates are de-duplicated. On update, an omitted list falls back to the
   *    current assignment.
   */
  private resolveDepartmentIds(
    role: UserRole,
    provided: string[] | undefined,
    current?: string[],
  ): string[] {
    if (!this.isDeptRole(role)) {
      if (provided && provided.length > 0) {
        throw new BadRequestException(
          'Only Department SPOC and Viewer users may be assigned to a department',
        );
      }
      return [];
    }
    const target = [...new Set(provided ?? current ?? [])];
    if (target.length === 0) {
      throw new BadRequestException(
        'Department SPOC and Viewer users must be assigned to at least one department',
      );
    }
    return target;
  }

  private async assertDepartmentsExist(departmentIds: string[]): Promise<void> {
    if (departmentIds.length === 0) return;
    const found = await this.prisma.corpDepartment.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true },
    });
    if (found.length !== departmentIds.length) {
      throw new BadRequestException('One or more department ids are invalid');
    }
  }

  async list(status: ActiveFilter = 'all', portal?: PortalTab): Promise<AdminUser[]> {
    const activeWhere =
      status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};
    // Clinic/corporate split: filter to that portal's roles (FINANCE_ADMIN, the
    // cross-tab account, is in BOTH lists). Derived from ROLE_TABS via rolesForTab,
    // so it can't drift from the tab-visibility source of truth.
    const roleWhere = portal ? { role: { in: rolesForTab(portal) } } : {};
    const users = await this.prisma.user.findMany({
      where: { ...activeWhere, ...roleWhere },
      include: userInclude,
      orderBy: { name: 'asc' },
    });
    return users.map(toAdminUser);
  }

  async get(id: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!user) throw new NotFoundException('User not found');
    return toAdminUser(user);
  }

  /**
   * Map the unique-email violation (Prisma P2002) to the same 409 the up-front
   * lookup produces. The lookup and the write are check-then-act, so two admins
   * claiming one address concurrently would otherwise surface as a raw 500.
   * (Same idiom as ExpenseHeadsService.rethrowDuplicateGlAccountNo.)
   */
  private rethrowDuplicateEmail(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | string | undefined)?.includes('email')
    ) {
      throw new ConflictException('Email already in use');
    }
    throw err;
  }

  async create(dto: CreateUserDto): Promise<AdminUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const clinicIds = this.resolveClinicIds(dto.role, dto.clinicIds);
    await this.assertClinicsExist(clinicIds);
    const departmentIds = this.resolveDepartmentIds(dto.role, dto.departmentIds);
    await this.assertDepartmentsExist(departmentIds);
    const passwordHash = await this.auth.hashPassword(dto.password);

    const user = await this.prisma.user
      .create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: dto.role,
          assignments: { create: clinicIds.map((clinicId) => ({ clinicId })) },
          departmentAssignments: {
            create: departmentIds.map((departmentId) => ({ departmentId })),
          },
        },
        include: userInclude,
      })
      .catch((err) => this.rethrowDuplicateEmail(err));
    await this.audit.record({
      action: AuditAction.USER_CREATE,
      entityType: 'User',
      entityId: user.id,
      newValue: { name: dto.name, email: dto.email, role: dto.role, clinicIds, departmentIds },
    });
    // New user has no sessions yet — nothing to invalidate.
    return toAdminUser(user);
  }

  async update(id: string, dto: UpdateUserDto, requesterId: string): Promise<AdminUser> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      include: userInclude,
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

    const currentDepartmentIds = current.departmentAssignments.map((a) => a.departmentId);
    let targetDepartmentIds = currentDepartmentIds;
    let deptAssignmentsTouched = false;
    if (dto.departmentIds !== undefined || roleChanged) {
      targetDepartmentIds = this.resolveDepartmentIds(newRole, dto.departmentIds, currentDepartmentIds);
      await this.assertDepartmentsExist(targetDepartmentIds);
      deptAssignmentsTouched = true;
    }
    const deptAssignmentsChanged =
      deptAssignmentsTouched && !sameSet(currentDepartmentIds, targetDepartmentIds);

    const passwordChanged = dto.password !== undefined;

    // Email is editable, but only a DIFFERENT one counts: re-sending the current
    // address must stay a no-op (the uniqueness lookup would find the user's own
    // row, and it must not needlessly kill their session).
    const emailChanged = dto.email !== undefined && dto.email !== current.email;
    if (emailChanged) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email! } });
      // Exclude the user's own row: the email column collates utf8mb4_unicode_ci
      // (case- AND accent-insensitive), so a casing-only edit matches the target
      // itself and would 409 against an account that doesn't exist.
      if (existing && existing.id !== id) throw new ConflictException('Email already in use');
    }

    const userData: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) userData.name = dto.name;
    if (emailChanged) userData.email = dto.email;
    if (dto.role !== undefined) userData.role = dto.role;
    if (passwordChanged) userData.passwordHash = await this.auth.hashPassword(dto.password!);

    // Any security-relevant change kills outstanding sessions. An email change
    // counts — it moves the login identity.
    const sessionsChanged =
      emailChanged || roleChanged || assignmentsChanged || deptAssignmentsChanged || passwordChanged;

    const user = await this.prisma
      .$transaction(async (tx) => {
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
        if (deptAssignmentsChanged) {
          await tx.userDepartmentAssignment.deleteMany({ where: { userId: id } });
          if (targetDepartmentIds.length > 0) {
            await tx.userDepartmentAssignment.createMany({
              data: targetDepartmentIds.map((departmentId) => ({ userId: id, departmentId })),
            });
          }
        }
        // Session kill and audit row belong to the same commit as the change
        // itself: a retry is NOT idempotent (the second PATCH sees dto.email ===
        // current.email and does nothing), so anything left behind out here would
        // leave the new email live with the old session and no audit trail.
        if (sessionsChanged) {
          await this.auth.invalidateUserSessions(id, tx);
        }
        await this.audit.record(
          {
            action: AuditAction.USER_UPDATE,
            entityType: 'User',
            entityId: id,
            // Never log password material — only whether it changed.
            oldValue: {
              ...(emailChanged ? { email: current.email } : {}),
              role: current.role,
              clinicIds: currentClinicIds,
              departmentIds: currentDepartmentIds,
            },
            newValue: {
              ...(dto.name !== undefined ? { name: dto.name } : {}),
              ...(emailChanged ? { email: dto.email } : {}),
              role: newRole,
              clinicIds: targetClinicIds,
              departmentIds: targetDepartmentIds,
              passwordChanged,
            },
          },
          tx,
        );
        return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      })
      .catch((err) => this.rethrowDuplicateEmail(err));

    return toAdminUser(user);
  }

  /**
   * Deactivate/activate. Always invalidates sessions; leaves the user row and
   * every audit reference to it intact. This is the fallback whenever remove()
   * refuses, which is nearly always — see remove().
   */
  async setActive(id: string, isActive: boolean, requesterId: string): Promise<AdminUser> {
    const current = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new NotFoundException('User not found');
    if (requesterId === id && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      include: userInclude,
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

  /**
   * SAFE DELETE — hard-deletes a user ONLY when they appear nowhere in history.
   *
   * Every count below is an APPLICATION-level blocker, and it has to be: the FKs
   * pointing at User are a mix of RESTRICT (provision entries, comments,
   * attachments, Sec 24 settings — the DB would stop us) and SET NULL (AuditLog
   * .performedById, MonthlySubmission.reviewStartedById/.unlockedById — the DB
   * would NOT, it would quietly blank the actor on every audit row the user ever
   * wrote, and MySQL does not fire the append-only auditlog triggers for FK
   * actions). Relying on Prisma to raise P2003 would therefore destroy history
   * silently for exactly the rows that matter most.
   *
   * Since nearly every admin action writes an audit row naming its actor, in
   * practice any account that has ever done anything is undeletable and must be
   * deactivated instead. Deletion is for the mistyped account created an hour ago.
   *
   * Deleted with the user (no history): UserClinicAssignment,
   * UserDepartmentAssignment, RefreshToken and Notification, all via DB cascade.
   * Sessions need no explicit revocation — JwtAccessGuard re-checks that the user
   * still exists on every request, and the refresh tokens cascade away.
   */
  async remove(id: string, requesterId: string): Promise<AdminUser> {
    await this.get(id); // 404 if missing (the authoritative read happens under the lock below)

    if (requesterId === id) {
      throw new BadRequestException('You cannot delete your own account');
    }

    // Guards, counts, audit row and delete all live in ONE interactive
    // transaction: every check above is check-then-act, and a row inserted
    // between a check and the delete is exactly the history this method exists
    // to protect.
    return this.prisma.$transaction(async (tx) => {
      // Lock the FINANCE_ADMIN rows (covered by @@index([role])) before counting
      // them. Two admins deleting each other concurrently would otherwise both
      // read "one other admin remains" and leave the portal with none — only
      // recoverable by running prisma/seed-admin.ts against the database.
      // This lock comes FIRST and the target row second: a fixed order, so the
      // reciprocal case (A deleting B while B deletes A, where each holds the
      // other's row) serializes instead of deadlocking into a 500.
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE role = 'FINANCE_ADMIN' AND isActive = true FOR UPDATE`;
      // Lock the row being deleted. The counts below are snapshot reads
      // (REPEATABLE READ) while the DELETE is a current read, so without this an
      // audit row the target writes in between is invisible to the count and gets
      // its actor silently SET NULL by the FK — and MySQL does not fire the
      // append-only trigger for an FK action. Any INSERT referencing the user
      // takes a shared lock on this row, so it blocks until the delete commits.
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${id} FOR UPDATE`;

      // Re-read under the locks: `user` was loaded before them, so a PATCH that
      // promoted this account to FINANCE_ADMIN or reactivated it in between would
      // slip past the guard below and take the portal's last admin with it.
      const locked = await tx.user.findUnique({ where: { id }, include: userInclude });
      if (!locked) throw new NotFoundException('User not found');
      const before = toAdminUser(locked);

      if (before.role === UserRole.FINANCE_ADMIN && before.isActive) {
        const otherAdmins = await tx.user.count({
          where: { role: UserRole.FINANCE_ADMIN, isActive: true, id: { not: id } },
        });
        if (otherAdmins === 0) {
          throw new BadRequestException(
            'You cannot delete the last active Finance Admin — no one would be able to administer the portal',
          );
        }
      }

      const [
        provisionEntries,
        corpProvisionEntries,
        comments,
        corpComments,
        attachments,
        reviews,
        sec24Configs,
        auditRows,
      ] = await Promise.all([
        tx.provisionEntry.count({
          where: { OR: [{ enteredById: id }, { lastModifiedById: id }] },
        }),
        tx.corpProvisionEntry.count({
          where: { OR: [{ enteredById: id }, { lastModifiedById: id }] },
        }),
        tx.submissionComment.count({ where: { commentedById: id } }),
        tx.corpSubmissionComment.count({ where: { commentedById: id } }),
        tx.commentAttachment.count({ where: { uploadedById: id } }),
        tx.monthlySubmission.count({
          where: { OR: [{ reviewStartedById: id }, { unlockedById: id }] },
        }),
        tx.sec24AllocationConfig.count({ where: { setById: id } }),
        tx.auditLog.count({ where: { performedById: id } }),
      ]);

      const found: string[] = [];
      const note = (n: number, one: string, many: string) => {
        if (n > 0) found.push(`${n} ${n === 1 ? one : many}`);
      };
      note(provisionEntries + corpProvisionEntries, 'provision entry', 'provision entries');
      note(comments + corpComments, 'comment', 'comments');
      note(attachments, 'attachment', 'attachments');
      note(reviews, 'submission review', 'submission reviews');
      note(sec24Configs, 'Sec 24 allocation setting', 'Sec 24 allocation settings');
      note(auditRows, 'audit log entry', 'audit log entries');
      if (found.length > 0) {
        throw new ConflictException(
          `This user appears in submission history (${found.join(', ')}) and cannot be deleted. Deactivate the account instead.`,
        );
      }

      // Audit BEFORE the delete, in the same transaction: this row is the only
      // surviving record of who the user was, so it must not be possible for the
      // delete to commit without it. Safe to write here because self-delete is
      // blocked above — the actor is never the row being removed.
      await this.audit.record(
        {
          action: AuditAction.USER_DELETE,
          entityType: 'User',
          entityId: id,
          oldValue: {
            name: before.name,
            email: before.email,
            role: before.role,
            isActive: before.isActive,
            clinicIds: before.clinicIds,
            departmentIds: before.departmentIds,
          },
        },
        tx,
      );

      try {
        await tx.user.delete({ where: { id } });
      } catch (err) {
        // Another admin deleted the same row between get() and here.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new NotFoundException('User not found');
        }
        throw err;
      }
      return before;
    });
  }
}

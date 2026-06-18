import { Injectable } from '@nestjs/common';
import { FINANCE_ROLES, type UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../auth/request-user';

/**
 * Resolves which clinics a user may act on.
 *
 * Finance roles (FINANCE_ADMIN / FINANCE_MANAGER) have org-wide access to every
 * clinic; clinic-scoped roles are limited to the clinics they're assigned to
 * (carried on the access token as `clinicIds`).
 */
@Injectable()
export class ClinicScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** True for roles with org-wide (all-clinic) access. */
  hasFullClinicAccess(user: RequestUser): boolean {
    return (FINANCE_ROLES as readonly UserRole[]).includes(user.role);
  }

  /**
   * The set of clinic IDs this user may act on: all clinics for finance roles,
   * the assigned clinic IDs for clinic roles. Useful for scoping list queries.
   */
  async accessibleClinicIds(user: RequestUser): Promise<string[]> {
    if (this.hasFullClinicAccess(user)) {
      const clinics = await this.prisma.clinic.findMany({ select: { id: true } });
      return clinics.map((c) => c.id);
    }
    return user.clinicIds;
  }

  /**
   * Membership check equivalent to `clinicId ∈ accessibleClinicIds(user)`, but
   * short-circuits for finance roles to avoid loading every clinic id.
   */
  canAccessClinic(user: RequestUser, clinicId: string): boolean {
    return this.hasFullClinicAccess(user) || user.clinicIds.includes(clinicId);
  }

  /** Resolve the clinic a submission belongs to, or null if it doesn't exist. */
  async resolveSubmissionClinicId(submissionId: string): Promise<string | null> {
    const submission = await this.prisma.monthlySubmission.findUnique({
      where: { id: submissionId },
      select: { clinicId: true },
    });
    return submission?.clinicId ?? null;
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClinicScopeService } from '../clinic-scope.service';
import type { RequestUser } from '../../auth/request-user';

/**
 * Restricts a route to clinics the caller may act on. Apply with
 * `@UseGuards(ClinicScopeGuard)` on routes that target a specific clinic or a
 * submission belonging to one. Runs after the global JwtAccessGuard, so
 * `request.user` is populated.
 *
 * The target clinic is taken from the route params, in order:
 *   1. `:clinicId`     — used directly.
 *   2. `:submissionId` — resolved to its clinic via ClinicScopeService.
 *
 * Rejects with 403 if the target clinic isn't in the caller's accessible set,
 * 404 if a referenced submission doesn't exist.
 */
@Injectable()
export class ClinicScopeGuard implements CanActivate {
  constructor(private readonly scope: ClinicScopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      // Should never happen behind the global JwtAccessGuard, but fail closed.
      throw new ForbiddenException('Not authenticated');
    }

    const params = request.params as Record<string, string | undefined>;
    let clinicId = params.clinicId ?? null;

    if (!clinicId && params.submissionId) {
      clinicId = await this.scope.resolveSubmissionClinicId(params.submissionId);
      if (!clinicId) {
        throw new NotFoundException('Submission not found');
      }
    }

    if (!clinicId) {
      // Developer error: guard applied to a route without a resolvable clinic.
      throw new InternalServerErrorException(
        'ClinicScopeGuard requires a :clinicId or :submissionId route param',
      );
    }

    if (!this.scope.canAccessClinic(user, clinicId)) {
      throw new ForbiddenException('Clinic not in your accessible scope');
    }
    return true;
  }
}

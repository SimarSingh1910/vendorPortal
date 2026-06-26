import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CorpDepartmentScopeService } from '../corp-department-scope.service';
import type { RequestUser } from '../../auth/request-user';

/**
 * Restricts a corporate route to departments the caller may act on — the
 * corporate analogue of ClinicScopeGuard. Apply with
 * `@UseGuards(CorpDepartmentScopeGuard)` on routes targeting a department or a
 * submission belonging to one. Runs after the global JwtAccessGuard, so
 * `request.user` is populated.
 *
 * The target department is taken from the route params, in order:
 *   1. `:departmentId` — used directly.
 *   2. `:submissionId` — resolved to its department.
 *
 * 403 if the department isn't in the caller's accessible set; 404 if a referenced
 * submission doesn't exist. The service re-checks scope too (defence in depth).
 */
@Injectable()
export class CorpDepartmentScopeGuard implements CanActivate {
  constructor(private readonly scope: CorpDepartmentScopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const params = request.params as Record<string, string | undefined>;
    let departmentId = params.departmentId ?? null;

    if (!departmentId && params.submissionId) {
      departmentId = await this.scope.resolveSubmissionDepartmentId(params.submissionId);
      if (!departmentId) {
        throw new NotFoundException('Submission not found');
      }
    }

    if (!departmentId) {
      throw new InternalServerErrorException(
        'CorpDepartmentScopeGuard requires a :departmentId or :submissionId route param',
      );
    }

    if (!(await this.scope.canAccessDepartment(user, departmentId))) {
      throw new ForbiddenException('Department not in your accessible scope');
    }
    return true;
  }
}

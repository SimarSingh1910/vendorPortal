import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { CORP_FINANCE_APPROVER_ROLES } from '../common/rbac.constants';
import { CorpDepartmentScopeGuard } from './guards/corp-department-scope.guard';
import { CorpProvisionEntryService } from './corp-provision-entry.service';
import { CorpSaveEntriesDto } from './dto/corp-save-entries.dto';

/**
 * Corporate provision data entry. A dept SPOC saves a partial draft (every line
 * carries a budget code); a corporate approver may edit values as an audited
 * override DURING their review window (SUBMITTED / FINANCE_MANAGER_REVIEW, BR-C08).
 * Department-scoped via the :submissionId-resolving guard; the service enforces
 * role/lock/state rules, budget-code validity, and audit.
 */
@Controller('corp/submissions/:submissionId/entries')
@Roles(UserRole.DEPT_SPOC, ...CORP_FINANCE_APPROVER_ROLES)
@RequireTab(PortalTab.CORPORATE)
@UseGuards(CorpDepartmentScopeGuard)
export class CorpProvisionEntryController {
  constructor(private readonly entries: CorpProvisionEntryService) {}

  @Put()
  save(
    @Param('submissionId') submissionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CorpSaveEntriesDto,
  ) {
    return this.entries.saveEntries(submissionId, user, dto.entries);
  }
}

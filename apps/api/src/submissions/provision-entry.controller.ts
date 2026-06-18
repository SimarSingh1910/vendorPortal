import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { ClinicScopeGuard } from '../common/guards/clinic-scope.guard';
import { ProvisionEntryService } from './provision-entry.service';
import { SaveEntriesDto } from './dto/save-entries.dto';

/**
 * Provision data entry. SPOC saves a partial draft; a finance approver (Admin or
 * Manager) may edit at any status as an audited override (BR-08). Clinic-scoped
 * via the :submissionId-resolving guard; the service enforces lock/state rules
 * and audit.
 */
@Controller('submissions/:submissionId/entries')
@Roles(UserRole.CLINIC_SPOC, UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
@UseGuards(ClinicScopeGuard)
export class ProvisionEntryController {
  constructor(private readonly entries: ProvisionEntryService) {}

  @Put()
  save(
    @Param('submissionId') submissionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SaveEntriesDto,
  ) {
    return this.entries.saveEntries(submissionId, user, dto.entries);
  }
}

import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { ClinicScopeGuard } from '../common/guards/clinic-scope.guard';
import { ProvisionEntryService } from './provision-entry.service';
import { SaveEntriesDto } from './dto/save-entries.dto';

/**
 * SPOC provision data entry (Step 6.1). Save is a partial upsert (any subset of
 * heads). SPOC only, clinic-scoped via the :submissionId-resolving guard. The
 * service re-checks role-editable status; submit is the workflow transition.
 */
@Controller('submissions/:submissionId/entries')
@Roles(UserRole.CLINIC_SPOC)
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

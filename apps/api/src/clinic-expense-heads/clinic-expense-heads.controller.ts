import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClinicExpenseHeadsService } from './clinic-expense-heads.service';
import { SetMappingsDto } from './dto/set-mappings.dto';

/**
 * Clinic ↔ expense-head mapping (FR-01). Reading the mapped set is open to
 * Finance Admin or Manager; SETTING the mapping is FINANCE_ADMIN-only
 * (method-level @Roles overrides the class-level one).
 * A head applies to a clinic ONLY if explicitly mapped here and active.
 */
@Controller('clinics/:clinicId/expense-heads')
@Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
export class ClinicExpenseHeadsController {
  constructor(private readonly mappings: ClinicExpenseHeadsService) {}

  /** The heads that currently apply to this clinic (provision-form set). */
  @Get()
  list(@Param('clinicId') clinicId: string) {
    return this.mappings.listMapped(clinicId);
  }

  /** Set the exact active mapping set for this clinic. */
  @Put()
  @Roles(UserRole.FINANCE_ADMIN)
  set(@Param('clinicId') clinicId: string, @Body() dto: SetMappingsDto) {
    return this.mappings.setMappings(clinicId, dto.expenseHeadIds);
  }
}

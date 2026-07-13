import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { ListClinicsQuery } from './dto/list-clinics.query';
import { UpdateClinicDto } from './dto/update-clinic.dto';

/**
 * Clinic master data (FR-01). READS (list/get) are open to Finance Admin or
 * Manager (other finance screens, e.g. the audit clinic filter, depend on them);
 * WRITES (create/update/activate/deactivate) are FINANCE_ADMIN-only — the
 * method-level @Roles overrides the class-level one via RolesGuard's
 * getAllAndOverride. Enforced by the global RolesGuard behind JwtAccessGuard.
 */
@Controller('clinics')
@Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
@RequireTab(PortalTab.CLINIC)
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Post()
  @Roles(UserRole.FINANCE_ADMIN)
  create(@Body() dto: CreateClinicDto) {
    return this.clinics.create(dto);
  }

  @Get()
  list(@Query() query: ListClinicsQuery) {
    return this.clinics.list(query.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clinics.get(id);
  }

  @Patch(':id')
  @Roles(UserRole.FINANCE_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinics.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.FINANCE_ADMIN)
  deactivate(@Param('id') id: string) {
    return this.clinics.setActive(id, false);
  }

  @Patch(':id/activate')
  @Roles(UserRole.FINANCE_ADMIN)
  activate(@Param('id') id: string) {
    return this.clinics.setActive(id, true);
  }
}

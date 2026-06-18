import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { ListClinicsQuery } from './dto/list-clinics.query';
import { UpdateClinicDto } from './dto/update-clinic.dto';

/**
 * Clinic master data (FR-01). Finance Admin or Manager — the class-level @Roles
 * is enforced by the global RolesGuard, behind the global JwtAccessGuard.
 */
@Controller('clinics')
@Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Post()
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
  update(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinics.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.clinics.setActive(id, false);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.clinics.setActive(id, true);
  }
}

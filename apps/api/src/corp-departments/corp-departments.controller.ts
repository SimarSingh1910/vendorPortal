import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CorpDepartmentsService } from './corp-departments.service';
import { CreateCorpDepartmentDto } from './dto/create-corp-department.dto';
import { ListCorpDepartmentsQuery } from './dto/list-corp-departments.query';
import { UpdateCorpDepartmentDto } from './dto/update-corp-department.dto';

/**
 * Corporate department master data (Step C1.1). Master-data MANAGEMENT is
 * FINANCE_ADMIN-only (consistent with the clinic masters), so the whole
 * controller is admin-gated; every other role gets 403 via RolesGuard.
 * @RequireTab(CORPORATE) additionally keeps clinic-only roles off corporate
 * routes (FINANCE_ADMIN is the only cross-tab role). Both guards run behind the
 * global JwtAccessGuard.
 */
@Controller('corp/departments')
@Roles(UserRole.FINANCE_ADMIN)
@RequireTab(PortalTab.CORPORATE)
export class CorpDepartmentsController {
  constructor(private readonly departments: CorpDepartmentsService) {}

  @Post()
  create(@Body() dto: CreateCorpDepartmentDto) {
    return this.departments.create(dto);
  }

  @Get()
  list(@Query() query: ListCorpDepartmentsQuery) {
    return this.departments.list(query.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.departments.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCorpDepartmentDto) {
    return this.departments.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.departments.setActive(id, false);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.departments.setActive(id, true);
  }
}

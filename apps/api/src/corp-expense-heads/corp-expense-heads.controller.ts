import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CorpExpenseHeadsService } from './corp-expense-heads.service';
import { CreateCorpExpenseHeadDto } from './dto/create-corp-expense-head.dto';
import { ListCorpExpenseHeadsQuery } from './dto/list-corp-expense-heads.query';
import { UpdateCorpExpenseHeadDto } from './dto/update-corp-expense-head.dto';

/**
 * Corporate expense-head master data (Step C1.1), nested under a department —
 * heads are dept-specific, NOT shared (BR-C09). Master-data MANAGEMENT is
 * FINANCE_ADMIN-only, so the whole controller is admin-gated (RolesGuard) and
 * tab-gated to CORPORATE (TabGuard); every other role gets 403.
 */
@Controller('corp/departments/:departmentId/expense-heads')
@Roles(UserRole.FINANCE_ADMIN)
@RequireTab(PortalTab.CORPORATE)
export class CorpExpenseHeadsController {
  constructor(private readonly heads: CorpExpenseHeadsService) {}

  @Post()
  create(@Param('departmentId') departmentId: string, @Body() dto: CreateCorpExpenseHeadDto) {
    return this.heads.create(departmentId, dto);
  }

  @Get()
  list(@Param('departmentId') departmentId: string, @Query() query: ListCorpExpenseHeadsQuery) {
    return this.heads.list(departmentId, query.status);
  }

  @Get(':id')
  get(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.heads.get(departmentId, id);
  }

  @Patch(':id')
  update(
    @Param('departmentId') departmentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCorpExpenseHeadDto,
  ) {
    return this.heads.update(departmentId, id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.heads.setActive(departmentId, id, false);
  }

  @Patch(':id/activate')
  activate(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.heads.setActive(departmentId, id, true);
  }
}

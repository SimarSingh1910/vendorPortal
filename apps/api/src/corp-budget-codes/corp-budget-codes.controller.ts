import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CorpBudgetCodesService } from './corp-budget-codes.service';
import { CreateCorpBudgetCodeDto } from './dto/create-corp-budget-code.dto';
import { ListCorpBudgetCodesQuery } from './dto/list-corp-budget-codes.query';
import { UpdateCorpBudgetCodeDto } from './dto/update-corp-budget-code.dto';

/**
 * Corporate budget-code master data (Step C1.2), nested under a department —
 * codes are dept-specific (BR-C01) and unique within their department. Master-
 * data MANAGEMENT is FINANCE_ADMIN-only, so the whole controller is admin-gated
 * (RolesGuard) and tab-gated to CORPORATE (TabGuard); every other role gets 403.
 */
@Controller('corp/departments/:departmentId/budget-codes')
@Roles(UserRole.FINANCE_ADMIN)
@RequireTab(PortalTab.CORPORATE)
export class CorpBudgetCodesController {
  constructor(private readonly budgetCodes: CorpBudgetCodesService) {}

  @Post()
  create(@Param('departmentId') departmentId: string, @Body() dto: CreateCorpBudgetCodeDto) {
    return this.budgetCodes.create(departmentId, dto);
  }

  @Get()
  list(@Param('departmentId') departmentId: string, @Query() query: ListCorpBudgetCodesQuery) {
    return this.budgetCodes.list(departmentId, query.status);
  }

  @Get(':id')
  get(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.budgetCodes.get(departmentId, id);
  }

  @Patch(':id')
  update(
    @Param('departmentId') departmentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCorpBudgetCodeDto,
  ) {
    return this.budgetCodes.update(departmentId, id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.budgetCodes.setActive(departmentId, id, false);
  }

  @Patch(':id/activate')
  activate(@Param('departmentId') departmentId: string, @Param('id') id: string) {
    return this.budgetCodes.setActive(departmentId, id, true);
  }
}

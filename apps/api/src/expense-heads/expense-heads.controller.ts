import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExpenseHeadsService } from './expense-heads.service';
import { CreateExpenseHeadDto } from './dto/create-expense-head.dto';
import { ListExpenseHeadsQuery } from './dto/list-expense-heads.query';
import { UpdateExpenseHeadDto } from './dto/update-expense-head.dto';

/** Expense-head master data (FR-01). Finance Admin only. */
@Controller('expense-heads')
@Roles(UserRole.FINANCE_ADMIN)
export class ExpenseHeadsController {
  constructor(private readonly expenseHeads: ExpenseHeadsService) {}

  @Post()
  create(@Body() dto: CreateExpenseHeadDto) {
    return this.expenseHeads.create(dto);
  }

  @Get()
  list(@Query() query: ListExpenseHeadsQuery) {
    return this.expenseHeads.list(query.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.expenseHeads.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseHeadDto) {
    return this.expenseHeads.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.expenseHeads.setActive(id, false);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.expenseHeads.setActive(id, true);
  }
}

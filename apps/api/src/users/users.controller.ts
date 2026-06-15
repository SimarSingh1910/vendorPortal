import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';

/** User & access management (FR-02). Finance Admin only. */
@Controller('users')
@Roles(UserRole.FINANCE_ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: RequestUser) {
    return this.users.update(id, dto, me.id);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() me: RequestUser) {
    return this.users.setActive(id, false, me.id);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() me: RequestUser) {
    return this.users.setActive(id, true, me.id);
  }
}

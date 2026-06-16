import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { NotificationConfigService } from './notification-config.service';
import { NotificationConfigDto } from './dto/notification-config.dto';

/**
 * Per-cycle notification config (Step 10.1). Finance Admin only.
 */
@Controller('notification-config')
@Roles(UserRole.FINANCE_ADMIN)
export class NotificationConfigController {
  constructor(private readonly config: NotificationConfigService) {}

  @Get()
  list() {
    return this.config.list();
  }

  @Get(':month')
  get(@Param('month') month: string) {
    return this.config.get(month);
  }

  @Put(':month')
  upsert(@Param('month') month: string, @Body() dto: NotificationConfigDto) {
    return this.config.upsert(month, dto);
  }
}

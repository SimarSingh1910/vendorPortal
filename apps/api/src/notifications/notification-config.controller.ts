import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { Portal } from '@prisma/client';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { NotificationConfigService } from './notification-config.service';
import { NotificationConfigDto } from './dto/notification-config.dto';
import { NotificationConfigQuery } from './dto/notification-config-query.dto';

/**
 * Per-cycle notification config (Step 10.1). Finance Admin or Manager. The
 * optional `?portal=CLINIC|CORPORATE` query selects which portal's config to
 * read/write; absent → CLINIC (the original, pre-split behaviour).
 */
@Controller('notification-config')
@Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
export class NotificationConfigController {
  constructor(private readonly config: NotificationConfigService) {}

  private toPortal(q: NotificationConfigQuery): Portal {
    return q.portal === PortalTab.CORPORATE ? Portal.CORPORATE : Portal.CLINIC;
  }

  @Get()
  list(@Query() query: NotificationConfigQuery) {
    return this.config.list(this.toPortal(query));
  }

  @Get(':month')
  get(@Param('month') month: string, @Query() query: NotificationConfigQuery) {
    return this.config.get(month, this.toPortal(query));
  }

  @Put(':month')
  upsert(
    @Param('month') month: string,
    @Body() dto: NotificationConfigDto,
    @Query() query: NotificationConfigQuery,
  ) {
    return this.config.upsert(month, dto, this.toPortal(query));
  }
}

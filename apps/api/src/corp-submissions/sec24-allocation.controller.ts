import { Body, Controller, Get, Post } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { Sec24AllocationService } from './sec24-allocation.service';
import { SetSec24AllocationDto } from './dto/set-sec24-allocation.dto';

/**
 * Sec 24 allocation-% configuration (Step C3.1). Finance-Admin only (RolesGuard),
 * Corporate tab only (TabGuard — keeps the clinic FINANCE_MANAGER out). Setting
 * the % appends a new history row (BR-C06); the % is never edited in place. Reads
 * expose the current value and the full append-only history (searchable/exportable).
 */
@Controller('corp/sec24/allocation')
@Roles(UserRole.FINANCE_ADMIN)
@RequireTab(PortalTab.CORPORATE)
export class Sec24AllocationController {
  constructor(private readonly sec24: Sec24AllocationService) {}

  @Post()
  set(@CurrentUser() user: RequestUser, @Body() dto: SetSec24AllocationDto) {
    return this.sec24.setAllocation(user, dto);
  }

  /** The latest-set allocation (null until the first % is ever set). */
  @Get('current')
  current() {
    return this.sec24.getCurrent();
  }

  /** Full append-only allocation history, newest first. */
  @Get('history')
  history() {
    return this.sec24.getHistory();
  }
}

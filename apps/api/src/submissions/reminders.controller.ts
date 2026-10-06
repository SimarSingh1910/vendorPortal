import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PortalTab, UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireTab } from '../auth/decorators/require-tab.decorator';
import { ReminderService } from './reminder.service';
import { SendRemindersDto } from './dto/send-reminders.dto';

/** Finance "Send reminder" from the dashboard — finance approvers only. */
@Controller('reminders')
@RequireTab(PortalTab.CLINIC)
@Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCE_MANAGER)
export class RemindersController {
  constructor(private readonly reminders: ReminderService) {}

  @Post()
  @HttpCode(200)
  send(@Body() dto: SendRemindersDto) {
    return this.reminders.send(dto.submissionIds);
  }
}

import { IsEnum, IsOptional } from 'class-validator';
import { PortalTab } from '@portal/shared';

/**
 * Which portal's per-cycle config to read/write. Optional and defaults to CLINIC
 * in the service, so the original clinic call sites keep working post-split.
 */
export class NotificationConfigQuery {
  @IsOptional()
  @IsEnum(PortalTab)
  portal?: PortalTab;
}

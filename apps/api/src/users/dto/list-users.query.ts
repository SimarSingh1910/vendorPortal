import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PortalTab, type ActiveFilter } from '@portal/shared';

export class ListUsersQuery {
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: ActiveFilter;

  /**
   * Optional clinic/corporate role-group filter for the split admin views. When
   * set, the list returns only roles that belong to that portal (FINANCE_ADMIN,
   * the cross-tab account, appears in BOTH). Absent → every user.
   */
  @IsOptional()
  @IsEnum(PortalTab)
  portal?: PortalTab;
}

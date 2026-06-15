import { IsIn, IsOptional } from 'class-validator';
import type { ActiveFilter } from '@portal/shared';

export class ListUsersQuery {
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: ActiveFilter;
}

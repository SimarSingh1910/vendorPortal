import { IsIn, IsOptional } from 'class-validator';
import type { ActiveFilter } from '@portal/shared';

export class ListCorpDepartmentsQuery {
  /** Filter by lifecycle state. Defaults to 'all' (admin sees everything). */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: ActiveFilter;
}

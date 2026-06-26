import { IsIn, IsOptional } from 'class-validator';
import type { ActiveFilter } from '@portal/shared';

export class ListCorpBudgetCodesQuery {
  /**
   * Filter by lifecycle state. Defaults to 'all' (admin management view). The
   * provision-entry dropdown (BR-C02) requests 'active' to get only the
   * department's currently-usable codes.
   */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: ActiveFilter;
}

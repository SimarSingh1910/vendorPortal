import { IsOptional, IsString } from 'class-validator';

/**
 * Body for the corporate admin "open now / re-run" endpoint. With `departmentId`
 * it opens that single department's cycle; omitted, it opens every active
 * department for the month.
 */
export class OpenCorpCycleDto {
  @IsOptional()
  @IsString()
  departmentId?: string;
}

import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Filters for the audit viewer. All optional; combine with AND. `from`/`to`
 * bound performedAt (inclusive). Paginated, newest first.
 */
export class AuditQueryDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsString()
  performedById?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

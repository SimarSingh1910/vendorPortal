import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { PortalTab } from '@portal/shared';

/**
 * Filters for the audit viewer. All optional; combine with AND. `from`/`to`
 * bound performedAt (inclusive). Paginated, newest first.
 */
export class AuditQueryDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  /**
   * Clinic/corporate portal filter over the single AuditLog: CORPORATE shows the
   * CORP_* actions, CLINIC shows the rest. Derived from the action name (no DB
   * column); ignored when an explicit `action` filter is set (that already pins
   * the portal). Absent → both portals.
   */
  @IsOptional()
  @IsEnum(PortalTab)
  portal?: PortalTab;

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

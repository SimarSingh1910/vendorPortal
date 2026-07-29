import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { SubmissionStatus } from '@portal/shared';
import { MONTH_RE } from '../../submissions/month.util';

/** Split a `status` query value (`A` or `A,B`) into a clean enum array. */
function toStatusArray(value: unknown): SubmissionStatus[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((v) => String(v).trim()).filter(Boolean) as SubmissionStatus[];
}

/** Split a comma list (`a` or `a,b`) query value into a clean id array. */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Filters shared by the analytics endpoints (FR-07). All optional; the service
 * applies clinic scoping on top regardless. `from`/`to` bound a YYYY-MM range;
 * `month` pins a single month (status tracker / variance).
 */
export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  /**
   * Multi-select clinic filter (`a` or `a,b`). Superset of `clinicId`; when both
   * are present the list wins. Each id is intersected with the caller's scope, so
   * it can only ever narrow what they may already see. OR within the list.
   */
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  clinicIds?: string[];

  @IsOptional()
  @IsString()
  expenseHeadId?: string;

  /**
   * Narrow to the clinics a given clinic SPOC covers. Resolved server-side from
   * that user's real assignments and intersected with the caller's own scope, so
   * an arbitrary user id here can only ever narrow the result, never widen it.
   */
  @IsOptional()
  @IsString()
  spocUserId?: string;

  /**
   * Multi-select SPOC filter (`a` or `a,b`). Superset of `spocUserId`; when both
   * are present the list wins. The union of the selected SPOCs' clinics is taken
   * (OR within the list), then intersected with the caller's scope — never widens.
   */
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  spocUserIds?: string[];

  @IsOptional()
  @Matches(MONTH_RE, { message: 'from must be in YYYY-MM format' })
  from?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'to must be in YYYY-MM format' })
  to?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'month must be in YYYY-MM format' })
  month?: string;

  @IsOptional()
  @Transform(({ value }) => toStatusArray(value))
  @IsArray()
  @IsEnum(SubmissionStatus, { each: true })
  status?: SubmissionStatus[];
}

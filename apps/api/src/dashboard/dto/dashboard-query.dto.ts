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

/**
 * Filters shared by the analytics endpoints (FR-07). All optional; the service
 * applies clinic scoping on top regardless. `from`/`to` bound a YYYY-MM range;
 * `month` pins a single month (status tracker / variance).
 */
export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsString()
  expenseHeadId?: string;

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

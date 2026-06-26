import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { CorpSubmissionStatus } from '@portal/shared';
import { MONTH_RE } from '../../submissions/month.util';

/** Split a `status` query value (`A` or `A,B`) into a clean enum array. */
function toStatusArray(value: unknown): CorpSubmissionStatus[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((v) => String(v).trim()).filter(Boolean) as CorpSubmissionStatus[];
}

/**
 * Filters shared by the corporate analytics endpoints (Step C4.1). All optional;
 * the service applies department scoping on top regardless. `from`/`to` bound a
 * YYYY-MM range; `month` pins a single month (status tracker / variance).
 */
export class CorpDashboardQueryDto {
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  expenseHeadId?: string;

  @IsOptional()
  @IsString()
  budgetCodeId?: string;

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
  @IsEnum(CorpSubmissionStatus, { each: true })
  status?: CorpSubmissionStatus[];
}

import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { MONTH_RE } from '../../submissions/month.util';

/**
 * Query for the month-wise clinic report (Step 4). `clinicId` is required and
 * re-checked against the caller's scope in the service. `months` is the count of
 * PRECEDING months (the current cycle month is always added); defaults to 3.
 */
export class ClinicMonthwiseQueryDto {
  @IsString()
  clinicId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  /** Optional cycle-month override (YYYY-MM); defaults to the current IST month. */
  @IsOptional()
  @Matches(MONTH_RE, { message: 'month must be in YYYY-MM format' })
  month?: string;
}

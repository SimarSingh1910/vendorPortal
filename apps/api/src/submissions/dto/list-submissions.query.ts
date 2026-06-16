import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { SubmissionStatus } from '@portal/shared';
import { MONTH_RE } from '../month.util';

/**
 * Query for GET /submissions. With `clinicId` → that clinic's submission history
 * (optionally filtered by status/month). Without it → the per-accessible-clinic
 * overview for `month` (defaults to the current IST month).
 */
export class ListSubmissionsQuery {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'month must be in YYYY-MM format' })
  month?: string;

  @IsOptional()
  @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;
}

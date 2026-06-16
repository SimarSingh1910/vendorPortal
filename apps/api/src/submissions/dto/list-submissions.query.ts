import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { SubmissionStatus } from '@portal/shared';
import { MONTH_RE } from '../month.util';

/** Split a `status` query value (`A` or `A,B`) into a clean enum array. */
function toStatusArray(value: unknown): SubmissionStatus[] | undefined {
  if (value === undefined || value === null) return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((v) => String(v).trim()).filter(Boolean) as SubmissionStatus[];
}

/**
 * Query for GET /submissions. Three modes:
 *   - `clinicId`         → that clinic's history (optional status/month filters).
 *   - `status` (no clinic) → the caller's cross-clinic work queue for those
 *                            statuses (e.g. a Manager's SUBMITTED + *_REVIEW).
 *   - neither            → per-accessible-clinic overview for `month`
 *                          (defaults to the current IST month).
 * `status` accepts a single value or a comma-separated list.
 */
export class ListSubmissionsQuery {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'month must be in YYYY-MM format' })
  month?: string;

  @IsOptional()
  @Transform(({ value }) => toStatusArray(value))
  @IsArray()
  @IsEnum(SubmissionStatus, { each: true })
  status?: SubmissionStatus[];
}

import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * Finance-Admin input to append a new Sec 24 allocation % (BR-C06 — every set is a
 * new row). A percentage in [0, 100] with at most 2 decimals, an effective month,
 * and an optional reason/note recorded in the history.
 */
export class SetSec24AllocationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  allocationPct!: number;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'effectiveFromMonth must be in YYYY-MM format' })
  effectiveFromMonth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

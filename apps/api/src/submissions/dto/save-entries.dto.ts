import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One value being written against a snapshot head, with an optional note. */
export class ProvisionEntryItemDto {
  @IsString()
  snapshotId!: string;

  // INR DECIMAL(14,2): non-negative, at most 2 decimals, within column range.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  amount!: number;

  // Optional SPOC line-item note. Blank/whitespace is normalised to null by the
  // service (don't persist empty strings); same length cap as the submit comment.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Partial save is allowed — any subset of the submission's heads. */
export class SaveEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProvisionEntryItemDto)
  entries!: ProvisionEntryItemDto[];
}

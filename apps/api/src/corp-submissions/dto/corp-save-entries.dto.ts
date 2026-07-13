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

/**
 * One corporate provision line being saved against a snapshot head. Both the
 * budget code and the amount are MANDATORY on every line (BR-C01): a blank line
 * is simply omitted from the array (a partial save), never sent with a missing
 * field. 0 is a valid amount.
 */
export class CorpProvisionEntryItemDto {
  @IsString()
  snapshotId!: string;

  @IsString()
  budgetCodeId!: string;

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

  // Optional free-text vendor name for this line. Blank/whitespace is normalised
  // to null by the service (never an empty string). Mirrors the clinic cap.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  vendorName?: string;

  // Optional free-text location for this line (per-line SPOC free text, NOT a
  // master/dropdown). Blank/whitespace is normalised to null by the service.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  location?: string;
}

/** Partial save is allowed — any subset of the submission's heads. */
export class CorpSaveEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CorpProvisionEntryItemDto)
  entries!: CorpProvisionEntryItemDto[];
}

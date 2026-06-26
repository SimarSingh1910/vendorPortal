import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsString,
  Max,
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
}

/** Partial save is allowed — any subset of the submission's heads. */
export class CorpSaveEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CorpProvisionEntryItemDto)
  entries!: CorpProvisionEntryItemDto[];
}

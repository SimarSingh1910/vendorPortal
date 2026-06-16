import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsString, Max, Min, ValidateNested } from 'class-validator';

/** One value being written against a snapshot head. */
export class ProvisionEntryItemDto {
  @IsString()
  snapshotId!: string;

  // INR DECIMAL(14,2): non-negative, at most 2 decimals, within column range.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  amount!: number;
}

/** Partial save is allowed — any subset of the submission's heads. */
export class SaveEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProvisionEntryItemDto)
  entries!: ProvisionEntryItemDto[];
}

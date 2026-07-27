import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PRODUCT_CODES } from '@portal/shared';

/** One vendor line within a head. `entryId` targets an existing line (update); its
 *  absence means a new line. `amount` may be null for a started-but-blank line. */
export class ProvisionLineItemDto {
  // Present → update this existing line; omitted → create a new line.
  @IsOptional()
  @IsString()
  entryId?: string;

  // INR DECIMAL(14,2): non-negative, at most 2 decimals, within column range, OR
  // null for a blank line (submit later rejects blank lines; 0 stays valid).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  amount!: number | null;

  // Optional SPOC line-item note. Blank/whitespace is normalised to null by the
  // service (don't persist empty strings); same length cap as the submit comment.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  // Optional free-text vendor name for this line. Blank/whitespace is normalised
  // to null by the service (never an empty string).
  @IsOptional()
  @IsString()
  @MaxLength(191)
  vendorName?: string;

  // Optional Product Code from the FIXED predefined set (single source of truth in
  // @portal/shared). Any value outside the set is rejected (400); blank/omitted is
  // normalised to null by the service.
  @IsOptional()
  @IsIn([...PRODUCT_CODES])
  productCode?: string;
}

/** The full desired set of lines for one snapshot head (reconciled by entryId). */
export class ProvisionEntryItemDto {
  @IsString()
  snapshotId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProvisionLineItemDto)
  lines!: ProvisionLineItemDto[];
}

/** Partial save is allowed — any subset of the submission's heads. */
export class SaveEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProvisionEntryItemDto)
  entries!: ProvisionEntryItemDto[];
}

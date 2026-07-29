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
import { PRODUCT_CODES, QUANTITY_DECIMALS, RATE_DECIMALS } from '@portal/shared';

/**
 * One particular (rate × quantity) within a vendor line. `particularId` targets an
 * existing row (update); its absence means a new row.
 *
 * There is deliberately NO `value` field — the value is rate × quantity computed
 * and rounded server-side. A client cannot assert it, so it can never contradict
 * the inputs it is supposed to be derived from.
 *
 * Rate and quantity are nullable because NULL ≠ 0: a started-but-blank row has no
 * rate yet, which submit rejects, whereas an explicit 0 is a perfectly valid rate.
 */
export class ProvisionParticularItemDto {
  // Present → update this existing particular; omitted → create a new one.
  @IsOptional()
  @IsString()
  particularId?: string;

  // What is being provisioned. Blank/whitespace is normalised to null by the
  // service (never an empty string); submit requires a non-null name.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  particularName?: string;

  // DECIMAL(14,4): non-negative, at most 4 decimals, OR null for a blank row.
  // The magnitude cap keeps rate × quantity inside DECIMAL(14,2) headroom and
  // keeps the scaled integer conversion exact.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: RATE_DECIMALS })
  @Min(0)
  @Max(99999999.9999)
  rate!: number | null;

  // DECIMAL(14,3): non-negative, at most 3 decimals, OR null for a blank row.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMALS })
  @Min(0)
  @Max(9999999.999)
  quantity!: number | null;
}

/**
 * One vendor line within a head. `entryId` targets an existing line (update); its
 * absence means a new line.
 *
 * There is deliberately NO `amount` field — the line amount is the sum of its
 * particulars' values, computed server-side.
 */
export class ProvisionLineItemDto {
  // Present → update this existing line; omitted → create a new line.
  @IsOptional()
  @IsString()
  entryId?: string;

  // The FULL desired set of particulars for this line, reconciled by particularId.
  // At least one is required — a vendor line never has zero particulars.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProvisionParticularItemDto)
  particulars!: ProvisionParticularItemDto[];

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

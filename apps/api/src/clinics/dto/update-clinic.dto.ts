import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Editable clinic fields. `isActive` is intentionally NOT here — activation is
 * an explicit lifecycle action (deactivate/activate endpoints), never a silent
 * field edit, and we never delete data.
 */
export class UpdateClinicDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  accLocationCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  customerCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  customerName?: string;
}

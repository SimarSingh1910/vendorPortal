import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClinicDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  // Fixed finance identifiers set per clinic by the Finance Admin — both REQUIRED,
  // shown read-only to the SPOC/reviewers (never SPOC-entered) and carried onto exports.
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  accLocationCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  customerCode!: string;
}

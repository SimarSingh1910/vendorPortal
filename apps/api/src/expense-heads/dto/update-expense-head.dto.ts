import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Editable fields. `isActive` is changed only via deactivate/activate, never deleted. */
export class UpdateExpenseHeadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  category?: string;
}

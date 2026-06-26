import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Editable budget-code fields. `isActive` is intentionally NOT here — activation
 * is an explicit lifecycle action (deactivate/activate), never a silent field
 * edit; deactivation retains history (BR-C10). Entries reference the code by id,
 * so editing the code string re-labels it everywhere without breaking links.
 */
export class UpdateCorpBudgetCodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

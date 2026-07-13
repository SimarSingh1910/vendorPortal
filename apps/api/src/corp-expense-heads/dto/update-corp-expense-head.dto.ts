import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Editable expense-head fields. `isActive` is intentionally NOT here —
 * activation is an explicit lifecycle action (deactivate/activate), never a
 * silent field edit; deactivation retains history (BR-C10).
 */
export class UpdateCorpExpenseHeadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;
}

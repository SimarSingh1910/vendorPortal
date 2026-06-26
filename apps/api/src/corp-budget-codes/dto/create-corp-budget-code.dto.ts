import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCorpBudgetCodeDto {
  /** The budget code itself (e.g. BR-C01). Unique within its department. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

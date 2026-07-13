import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExpenseHeadDto {
  /** G/L Account No. — required, unique (uniqueness enforced at the service/DB layer). */
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountNo!: string;

  /** G/L Account Name — required descriptive name. */
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountName!: string;
}

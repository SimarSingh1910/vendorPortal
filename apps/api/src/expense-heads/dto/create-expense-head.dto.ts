import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExpenseHeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  category!: string;
}

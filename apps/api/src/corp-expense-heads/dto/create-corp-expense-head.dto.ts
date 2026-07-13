import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCorpExpenseHeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;
}

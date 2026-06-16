import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** An optional reviewer note recorded alongside an approval. */
export class ApproveDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;
}

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** An optional SPOC note recorded on the timeline when submitting (Step 3). */
export class SubmitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;
}

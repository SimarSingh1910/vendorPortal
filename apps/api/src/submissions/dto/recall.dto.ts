import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** An optional SPOC reason recorded on the timeline when recalling a submission. */
export class RecallDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;
}

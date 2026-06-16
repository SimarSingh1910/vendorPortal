import { IsString, MaxLength, MinLength } from 'class-validator';

/** A mandatory reviewer comment, required when sending a submission back. */
export class SendBackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment!: string;
}

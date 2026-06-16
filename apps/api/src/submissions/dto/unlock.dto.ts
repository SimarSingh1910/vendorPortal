import { IsString, MaxLength, MinLength } from 'class-validator';

/** The mandatory reason for unlocking an approved (locked) submission. */
export class UnlockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

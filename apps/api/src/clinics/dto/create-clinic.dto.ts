import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClinicDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  location!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(191)
  corporateClient!: string;
}

import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@portal/shared';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  @IsEmail()
  @MaxLength(191)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  /** Only meaningful for clinic-scoped roles; ignored for finance roles. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clinicIds?: string[];
}

import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@portal/shared';

/**
 * Editable user fields. Email is immutable (stable identity). `isActive` is
 * changed only via the deactivate/activate endpoints. Providing `password`
 * resets it. Any role / clinicIds / password change invalidates the user's
 * sessions (handled in the service).
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clinicIds?: string[];
}

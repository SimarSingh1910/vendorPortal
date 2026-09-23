import {
  IsArray,
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '@portal/shared';

/**
 * Editable user fields. `isActive` is changed only via the deactivate/activate
 * endpoints. Providing `password` resets it. Any email / role / clinicIds /
 * departmentIds / password change invalidates the user's sessions (handled in
 * the service).
 *
 * Every field uses `@ValidateIf(… !== undefined)` rather than `@IsOptional()`:
 * `@IsOptional()` skips validation for null as well as undefined, so an explicit
 * `null` would sail through to the service — where `dto.x !== undefined` is true
 * for null — and hit Prisma as a NOT NULL write (a 500 where a 400 belongs).
 * Omitting a field still means "leave unchanged"; sending null is now a 400.
 */
export class UpdateUserDto {
  @ValidateIf((o: UpdateUserDto) => o.name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  /**
   * The login identity. Editable, but changing it is security-relevant: it is
   * what the user signs in with, so the service invalidates their sessions.
   * Validated exactly as on create. No trim or lowercasing: the email column
   * collates utf8mb4_unicode_ci, so lookups (and the unique index) are already
   * case- and accent-insensitive — normalising here but not in CreateUserDto /
   * LoginDto would desync the three.
   */
  @ValidateIf((o: UpdateUserDto) => o.email !== undefined)
  @IsEmail()
  @MaxLength(191)
  email?: string;

  @ValidateIf((o: UpdateUserDto) => o.role !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;

  @ValidateIf((o: UpdateUserDto) => o.password !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ValidateIf((o: UpdateUserDto) => o.clinicIds !== undefined)
  @IsArray()
  @IsString({ each: true })
  clinicIds?: string[];

  @ValidateIf((o: UpdateUserDto) => o.departmentIds !== undefined)
  @IsArray()
  @IsString({ each: true })
  departmentIds?: string[];
}

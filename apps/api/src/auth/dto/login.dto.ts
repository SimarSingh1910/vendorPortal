import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PortalTab } from '@portal/shared';

export class LoginDto {
  @IsEmail()
  @MaxLength(191)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /**
   * Which portal tab the sign-in came from. The account must be entitled to it —
   * see AuthService.login. OPTIONAL: omitting it authenticates with no portal
   * restriction, so existing callers (smoke scripts, older clients) are unaffected.
   */
  @IsOptional()
  @IsEnum(PortalTab)
  portal?: PortalTab;
}

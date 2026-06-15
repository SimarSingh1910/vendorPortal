import { IsJWT } from 'class-validator';

/** Used by both /auth/refresh and /auth/logout — the client sends its current refresh token. */
export class RefreshDto {
  @IsJWT()
  refreshToken!: string;
}

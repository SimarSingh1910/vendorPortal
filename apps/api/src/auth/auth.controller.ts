import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResponse, AuthUser } from '@portal/shared';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import type { RequestUser } from './request-user';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';

/**
 * Auth endpoints. The refresh token travels ONLY in an httpOnly cookie set here
 * (Phase 13.1): login/refresh set it, logout clears it, and refresh/logout read
 * it from the cookie — it is never in a request/response body. `login` and
 * `refresh` are additionally rate-limited (ThrottlerGuard) to blunt credential
 * stuffing and refresh abuse.
 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.login(dto.email, dto.password);
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = readRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const session = await this.auth.refresh(token);
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken, user: session.user };
  }

  // Public: logout authenticates via the refresh cookie and must work even when
  // the access token has expired. Idempotent; always clears the cookie.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const token = readRefreshCookie(req);
    if (token) {
      await this.auth.logout(token);
    }
    clearRefreshCookie(res);
    return { success: true };
  }

  /**
   * The authenticated caller's profile (behind the global JwtAccessGuard).
   * Used by the frontend to bootstrap the session and to detect invalidation —
   * it returns 401 once the session is killed (tokenVersion bump / deactivation).
   */
  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.getProfile(user.id);
  }
}

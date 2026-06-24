import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { RolesGuard } from './guards/roles.guard';
import { TabGuard } from './guards/tab.guard';

/**
 * Auth core: login / refresh / logout. Secrets and TTLs are read per-sign from
 * ConfigService (access and refresh use distinct secrets), so JwtModule is
 * registered without global defaults.
 *
 * Registers the three global guards. Order matters (APP_GUARD providers execute
 * in registration order): JwtAccessGuard first to populate request.user, then
 * RolesGuard enforces @Roles, then TabGuard enforces @RequireTab tab visibility.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAccessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TabGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Auth core: login / refresh / logout. Secrets and TTLs are read per-sign from
 * ConfigService (access and refresh use distinct secrets), so JwtModule is
 * registered without global defaults.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';
import { ClinicScopeService } from './clinic-scope.service';
import { ClinicScopeGuard } from './guards/clinic-scope.guard';

/**
 * Cross-cutting providers shared across feature modules. Global so any
 * controller can inject ClinicScopeService or apply ClinicScopeGuard via
 * @UseGuards without re-importing. (PrismaService comes from the global
 * PrismaModule.)
 */
@Global()
@Module({
  providers: [ClinicScopeService, ClinicScopeGuard],
  exports: [ClinicScopeService, ClinicScopeGuard],
})
export class CommonModule {}

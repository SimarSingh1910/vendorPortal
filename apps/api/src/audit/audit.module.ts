import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Append-only audit logging. Global so any feature can record an audit entry
 * without re-importing. (PrismaService comes from the global PrismaModule.)
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

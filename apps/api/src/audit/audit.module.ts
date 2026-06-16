import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryService } from './audit-query.service';
import { AuditExportService } from './audit-export.service';
import { AuditController } from './audit.controller';

/**
 * Append-only audit logging. Global so any feature can record an audit entry
 * (AuditService) without re-importing. Also hosts the Finance-Admin audit
 * viewer + export (Phase 9.2). (PrismaService comes from the global PrismaModule.)
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditExportService],
  exports: [AuditService],
})
export class AuditModule {}

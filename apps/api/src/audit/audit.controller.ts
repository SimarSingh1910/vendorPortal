import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@portal/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditQueryService } from './audit-query.service';
import { AuditExportService } from './audit-export.service';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * Audit viewer + export (Phase 9.2). Finance Admin only — the class-level
 * @Roles is enforced by the global RolesGuard behind the global JwtAccessGuard.
 */
@Controller('audit')
@Roles(UserRole.FINANCE_ADMIN)
export class AuditController {
  constructor(
    private readonly query: AuditQueryService,
    private readonly exporter: AuditExportService,
  ) {}

  @Get()
  search(@Query() filter: AuditQueryDto) {
    return this.query.search(filter);
  }

  /** Distinct action names for the filter dropdown. */
  @Get('actions')
  actions() {
    return this.query.distinctActions();
  }

  /** Export the currently-filtered set as .xlsx. */
  @Get('export')
  async export(@Query() filter: AuditQueryDto, @Res() res: Response): Promise<void> {
    const rows = await this.query.searchForExport(filter);
    const buffer = await this.exporter.toXlsx(rows);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="audit-log.xlsx"',
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}

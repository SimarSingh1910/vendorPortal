import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { CorpSubmissionsModule } from '../corp-submissions/corp-submissions.module';
import { ExportService } from './export.service';
import { CorpExportService } from './corp-export.service';
import { ExcelExportService } from './excel-export.service';
import { PdfExportService } from './pdf-export.service';
import { ExportController } from './export.controller';

/**
 * Export & reporting (FR-10, Phase 12). Excel (ExcelJS) + PDF (Puppeteer). Imports
 * DashboardModule to reuse the exact clinic-scoped analytics the PDF mirrors, and
 * CorpSubmissionsModule for the department-scope service behind the corporate
 * exports (which reuse the same ExcelJS builders in their own layout).
 */
@Module({
  imports: [DashboardModule, CorpSubmissionsModule],
  controllers: [ExportController],
  providers: [ExportService, CorpExportService, ExcelExportService, PdfExportService],
})
export class ExportModule {}

import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ExportService } from './export.service';
import { ExcelExportService } from './excel-export.service';
import { PdfExportService } from './pdf-export.service';
import { ExportController } from './export.controller';

/**
 * Export & reporting (FR-10, Phase 12). Excel (ExcelJS) + PDF (Puppeteer). Imports
 * DashboardModule to reuse the exact clinic-scoped analytics the PDF mirrors.
 */
@Module({
  imports: [DashboardModule],
  controllers: [ExportController],
  providers: [ExportService, ExcelExportService, PdfExportService],
})
export class ExportModule {}

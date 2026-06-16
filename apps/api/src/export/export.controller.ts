import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { currentMonthIST } from '../submissions/month.util';
import { DashboardService } from '../dashboard/dashboard.service';
import { DashboardQueryDto } from '../dashboard/dto/dashboard-query.dto';
import { ExportService } from './export.service';
import { ExcelExportService } from './excel-export.service';
import { PdfExportService } from './pdf-export.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Safe-ish filename fragment from a free-text name. */
function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export';
}

/** One-line description of the active filters for report headers. */
function filterNote(q: DashboardQueryDto, asOf: string): string {
  const parts = [`Range: ${q.from ?? 'earliest'} – ${q.to ?? asOf}`];
  if (q.clinicId) parts.push('clinic filter applied');
  if (q.expenseHeadId) parts.push('expense-head filter applied');
  if (q.status?.length) parts.push(`status: ${q.status.join(', ')}`);
  return parts.join('  ·  ');
}

/**
 * Export & reporting (FR-10, Phase 12). Excel via ExcelJS, PDF via Puppeteer.
 * Any authenticated role; every export is clinic-scoped in the services (finance
 * roles get all clinics, clinic roles only theirs), so a clinic user can only
 * ever export their own data.
 */
@Controller('export')
export class ExportController {
  constructor(
    private readonly data: ExportService,
    private readonly excel: ExcelExportService,
    private readonly pdf: PdfExportService,
    private readonly dashboard: DashboardService,
  ) {}

  private send(res: Response, buffer: Buffer, type: string, filename: string): void {
    res.set({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  /** Single clinic's data for one month. Requires clinicId + month. */
  @Get('excel/clinic-month')
  async clinicMonth(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser, @Res() res: Response) {
    if (!q.clinicId || !q.month) {
      throw new BadRequestException('clinicId and month are required');
    }
    const data = await this.data.clinicMonth(user, q.clinicId, q.month);
    const buffer = await this.excel.clinicMonth(data);
    this.send(res, buffer, XLSX_TYPE, `clinic-${slug(data.clinicName)}-${q.month}.xlsx`);
  }

  /** Consolidated data across clinics for a month or range, after filters. */
  @Get('excel/consolidated')
  async consolidated(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser, @Res() res: Response) {
    const asOf = q.to ?? q.month ?? currentMonthIST();
    const rows = await this.data.detailRows(user, q);
    const buffer = await this.excel.consolidated(rows, filterNote(q, asOf));
    this.send(res, buffer, XLSX_TYPE, `consolidated-${q.from ?? 'all'}_${q.to ?? asOf}.xlsx`);
  }

  /** One-click month-end provision report: all active clinics, current month. */
  @Get('excel/month-end')
  async monthEnd(@CurrentUser() user: RequestUser, @Res() res: Response) {
    const month = currentMonthIST();
    const data = await this.data.monthEnd(user, month);
    const buffer = await this.excel.monthEnd(data);
    this.send(res, buffer, XLSX_TYPE, `month-end-${month}.xlsx`);
  }

  /** Dashboard → PDF (Puppeteer), honoring the active filters. */
  @Get('pdf/dashboard')
  async dashboardPdf(@Query() q: DashboardQueryDto, @CurrentUser() user: RequestUser, @Res() res: Response) {
    const asOf = q.to ?? q.month ?? currentMonthIST();
    const [status, variance, monthly, headTrends, clinicTotals] = await Promise.all([
      this.dashboard.statusTracker(user, asOf),
      this.dashboard.variance(user, asOf, q.clinicId),
      this.dashboard.monthlyTotals(user, q),
      this.dashboard.headTrends(user, q),
      this.dashboard.clinicTotals(user, q),
    ]);
    const buffer = await this.pdf.render({
      month: asOf,
      filterNote: filterNote(q, asOf),
      status,
      variance,
      monthly,
      headTrends,
      clinicTotals,
    });
    this.send(res, buffer, 'application/pdf', `dashboard-${asOf}.pdf`);
  }
}

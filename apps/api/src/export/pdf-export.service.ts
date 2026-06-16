import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';
import {
  SUBMISSION_STATUS_LABELS,
  type ClinicTotalPoint,
  type DashboardStatusTile,
  type HeadTrendPoint,
  type MonthlyTotalPoint,
  type VarianceReport,
} from '@portal/shared';

export interface DashboardPdfData {
  month: string;
  filterNote: string;
  status: DashboardStatusTile[];
  variance: VarianceReport;
  monthly: MonthlyTotalPoint[];
  headTrends: HeadTrendPoint[];
  clinicTotals: ClinicTotalPoint[];
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (v: string | null) => (v == null ? '—' : inr.format(Number(v)));

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A simple CSS bar (so the PDF "looks like" the dashboard without a chart lib). */
function bar(value: number, max: number, label: string, color: string): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar-row"><span class="bar-label">${esc(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
    <span class="bar-val">${money(String(value))}</span></div>`;
}

/**
 * Dashboard → PDF (FR-10, Step 12.2) via Puppeteer. The endpoint re-runs the same
 * clinic-scoped aggregations under the active filters and renders a self-contained
 * HTML report (status, variance, month-on-month, head trends, clinic comparison)
 * that Chromium prints to PDF — so the PDF reflects the on-screen filtered
 * dashboard. The browser is launched once and reused across requests.
 */
@Injectable()
export class PdfExportService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  private browser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browserPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      const b = await this.browserPromise.catch(() => null);
      await b?.close().catch(() => undefined);
    }
  }

  async render(data: DashboardPdfData): Promise<Buffer> {
    const browser = await this.browser();
    const page = await browser.newPage();
    try {
      // The report HTML is fully self-contained (no external requests), so
      // 'load' is sufficient; 'networkidle0' isn't a valid setContent option.
      await page.setContent(this.html(data), { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private html(data: DashboardPdfData): string {
    const statusRows = data.status
      .map(
        (t) =>
          `<tr><td>${esc(t.clinicName)}</td><td>${esc(SUBMISSION_STATUS_LABELS[t.status])}</td>
           <td class="num">${money(t.total)}</td></tr>`,
      )
      .join('');

    const alerts = data.variance.rows.filter((r) => r.flagged);
    const varianceBlock = alerts.length
      ? `<table><thead><tr><th>Expense head</th><th class="num">Prior</th><th class="num">Current</th><th class="num">Δ%</th></tr></thead>
         <tbody>${alerts
           .map(
             (r) =>
               `<tr class="flag"><td>${esc(r.expenseHeadName)}</td><td class="num">${money(r.prior)}</td>
                <td class="num">${money(r.current)}</td>
                <td class="num">${r.deviationPercent != null ? `${r.deviationPercent}%` : 'new'}</td></tr>`,
           )
           .join('')}</tbody></table>`
      : `<p class="muted">${
          data.variance.thresholdPercent == null
            ? `No variance threshold configured for ${monthLabel(data.month)}.`
            : 'No heads breached the threshold this month.'
        }</p>`;

    const monthMax = Math.max(0, ...data.monthly.map((p) => Number(p.total)));
    const monthlyBars = data.monthly.length
      ? data.monthly.map((p) => bar(Number(p.total), monthMax, p.month, '#2563eb')).join('')
      : '<p class="muted">No data for the selected range.</p>';

    const clinicMax = Math.max(0, ...data.clinicTotals.map((c) => Number(c.total)));
    const clinicBars = data.clinicTotals.length
      ? data.clinicTotals.map((c) => bar(Number(c.total), clinicMax, c.clinicName, '#16a34a')).join('')
      : '<p class="muted">No data for the selected range.</p>';

    // Head trends pivot (month columns × head rows).
    const months = [...new Set(data.headTrends.map((d) => d.month))].sort();
    const heads = [...new Map(data.headTrends.map((d) => [d.expenseHeadId, d.expenseHeadName])).entries()];
    const headTrendTable = heads.length
      ? `<table><thead><tr><th>Expense head</th>${months
          .map((m) => `<th class="num">${esc(m)}</th>`)
          .join('')}</tr></thead><tbody>${heads
          .map(([id, name]) => {
            const cells = months
              .map((m) => {
                const pt = data.headTrends.find((d) => d.month === m && d.expenseHeadId === id);
                return `<td class="num">${pt ? money(pt.total) : '—'}</td>`;
              })
              .join('');
            return `<tr><td>${esc(name)}</td>${cells}</tr>`;
          })
          .join('')}</tbody></table>`
      : '<p class="muted">No expense-head data for the selected range.</p>';

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
      h1 { font-size: 20px; margin: 0 0 2px; }
      h2 { font-size: 14px; margin: 22px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .sub { color: #6b7280; font-size: 11px; margin-bottom: 4px; }
      .muted { color: #6b7280; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; }
      th { background: #f9fafb; font-size: 11px; }
      td.num, th.num { text-align: right; }
      tr.flag td { background: #fef2f2; color: #991b1b; }
      .bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
      .bar-label { width: 130px; font-size: 11px; }
      .bar-track { flex: 1; background: #f1f5f9; height: 14px; border-radius: 3px; overflow: hidden; }
      .bar-fill { display: block; height: 100%; }
      .bar-val { width: 110px; text-align: right; font-size: 11px; }
    </style></head><body>
      <h1>Finance Dashboard — ${monthLabel(data.month)}</h1>
      <div class="sub">${esc(data.filterNote)}</div>
      <h2>Submission status</h2>
      <table><thead><tr><th>Clinic</th><th>Status</th><th class="num">Total</th></tr></thead>
        <tbody>${statusRows || '<tr><td colspan="3" class="muted">No active clinics in scope.</td></tr>'}</tbody></table>
      <h2>Variance alerts vs ${monthLabel(data.variance.priorMonth)}${
        data.variance.thresholdPercent != null ? ` (±${data.variance.thresholdPercent}%)` : ''
      }</h2>
      ${varianceBlock}
      <h2>Month-on-month total expense</h2>
      ${monthlyBars}
      <h2>Clinic-wise total comparison</h2>
      ${clinicBars}
      <h2>Expense-head-wise trend</h2>
      ${headTrendTable}
    </body></html>`;
  }
}

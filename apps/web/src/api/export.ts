import { apiClient } from '@/lib/apiClient';
import type { DashboardFilter } from './dashboard';

/** Drop empty params; serialize a status array as a comma list. */
function clean(filter: DashboardFilter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) out[key] = value.join(',');
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/** GET a file as a blob and trigger a browser download (auth via the api client). */
async function download(path: string, params: Record<string, string>, fallbackName: string): Promise<void> {
  const response = await apiClient.get(path, { params, responseType: 'blob' });
  const disposition = response.headers['content-disposition'] as string | undefined;
  const name = disposition?.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Single clinic's monthly data (.xlsx). */
export function exportClinicMonth(clinicId: string, month: string): Promise<void> {
  return download('/export/excel/clinic-month', clean({ clinicId, month }), `clinic-${month}.xlsx`);
}

/** Consolidated all-clinic data for the filtered range (.xlsx). */
export function exportConsolidated(filter: DashboardFilter): Promise<void> {
  return download('/export/excel/consolidated', clean(filter), 'consolidated.xlsx');
}

/** One-click full month-end provision report for the current month (.xlsx). */
export function exportMonthEnd(): Promise<void> {
  return download('/export/excel/month-end', {}, 'month-end.xlsx');
}

/** Dashboard as PDF, honoring the active filters. */
export function exportDashboardPdf(filter: DashboardFilter): Promise<void> {
  return download('/export/pdf/dashboard', clean(filter), 'dashboard.pdf');
}

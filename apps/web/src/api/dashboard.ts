import type {
  ClinicTotalPoint,
  DashboardFilterOptions,
  DashboardStatusTile,
  HeadTrendPoint,
  MonthlyTotalPoint,
  SubmissionStatus,
  VarianceReport,
} from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

export interface DashboardFilter {
  clinicId?: string;
  expenseHeadId?: string;
  from?: string; // YYYY-MM
  to?: string; // YYYY-MM
  month?: string; // YYYY-MM
  status?: SubmissionStatus[];
}

/** Drop empty params; serialize a status array as a comma list (the DTO splits it). */
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

export async function getStatusTracker(month?: string): Promise<DashboardStatusTile[]> {
  const { data } = await apiClient.get<DashboardStatusTile[]>('/dashboard/status', {
    params: clean({ month }),
  });
  return data;
}

export async function getMonthlyTotals(filter: DashboardFilter): Promise<MonthlyTotalPoint[]> {
  const { data } = await apiClient.get<MonthlyTotalPoint[]>('/dashboard/monthly-totals', {
    params: clean(filter),
  });
  return data;
}

export async function getHeadTrends(filter: DashboardFilter): Promise<HeadTrendPoint[]> {
  const { data } = await apiClient.get<HeadTrendPoint[]>('/dashboard/head-trends', {
    params: clean(filter),
  });
  return data;
}

export async function getClinicTotals(filter: DashboardFilter): Promise<ClinicTotalPoint[]> {
  const { data } = await apiClient.get<ClinicTotalPoint[]>('/dashboard/clinic-totals', {
    params: clean(filter),
  });
  return data;
}

export async function getVariance(month?: string, clinicId?: string): Promise<VarianceReport> {
  const { data } = await apiClient.get<VarianceReport>('/dashboard/variance', {
    params: clean({ month, clinicId }),
  });
  return data;
}

export async function getDashboardFilters(): Promise<DashboardFilterOptions> {
  const { data } = await apiClient.get<DashboardFilterOptions>('/dashboard/filters');
  return data;
}

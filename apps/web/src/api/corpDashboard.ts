import type {
  CorpDashboardFilterOptions,
  CorpDashboardStatusTile,
  CorpDepartmentTotalPoint,
  CorpDeptMonthlyTotalPoint,
  CorpHeadTrendPoint,
  CorpMonthlyTotalPoint,
  CorpSec24MonthPoint,
  CorpSubmissionStatus,
  VarianceReport,
} from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Corporate dashboard client (Step C4.1). Read-only `/corp/dashboard/*` surface;
 * every figure is already aggregated + department-scoped server-side. Mirrors the
 * clinic `api/dashboard.ts` filter-cleaning convention.
 */
export interface CorpDashboardFilter {
  departmentId?: string;
  expenseHeadId?: string;
  budgetCodeId?: string;
  from?: string; // YYYY-MM
  to?: string; // YYYY-MM
  month?: string; // YYYY-MM
  status?: CorpSubmissionStatus[];
}

/** Drop empty params; serialize a status array as a comma list (the DTO splits it). */
function clean(filter: CorpDashboardFilter): Record<string, string> {
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

export async function getCorpStatusTracker(month?: string): Promise<CorpDashboardStatusTile[]> {
  const { data } = await apiClient.get<CorpDashboardStatusTile[]>('/corp/dashboard/status', {
    params: clean({ month }),
  });
  return data;
}

export async function getCorpMonthlyTotals(
  filter: CorpDashboardFilter,
): Promise<CorpMonthlyTotalPoint[]> {
  const { data } = await apiClient.get<CorpMonthlyTotalPoint[]>('/corp/dashboard/monthly-totals', {
    params: clean(filter),
  });
  return data;
}

export async function getCorpDeptMonthlyTotals(
  filter: CorpDashboardFilter,
): Promise<CorpDeptMonthlyTotalPoint[]> {
  const { data } = await apiClient.get<CorpDeptMonthlyTotalPoint[]>(
    '/corp/dashboard/dept-monthly-totals',
    { params: clean(filter) },
  );
  return data;
}

export async function getCorpHeadTrends(
  filter: CorpDashboardFilter,
): Promise<CorpHeadTrendPoint[]> {
  const { data } = await apiClient.get<CorpHeadTrendPoint[]>('/corp/dashboard/head-trends', {
    params: clean(filter),
  });
  return data;
}

export async function getCorpDepartmentTotals(
  filter: CorpDashboardFilter,
): Promise<CorpDepartmentTotalPoint[]> {
  const { data } = await apiClient.get<CorpDepartmentTotalPoint[]>(
    '/corp/dashboard/department-totals',
    { params: clean(filter) },
  );
  return data;
}

export async function getCorpSec24(filter: CorpDashboardFilter): Promise<CorpSec24MonthPoint[]> {
  const { data } = await apiClient.get<CorpSec24MonthPoint[]>('/corp/dashboard/sec24', {
    params: clean(filter),
  });
  return data;
}

export async function getCorpVariance(
  month?: string,
  departmentId?: string,
): Promise<VarianceReport> {
  const { data } = await apiClient.get<VarianceReport>('/corp/dashboard/variance', {
    params: clean({ month, departmentId }),
  });
  return data;
}

export async function getCorpDashboardFilters(): Promise<CorpDashboardFilterOptions> {
  const { data } = await apiClient.get<CorpDashboardFilterOptions>('/corp/dashboard/filters');
  return data;
}

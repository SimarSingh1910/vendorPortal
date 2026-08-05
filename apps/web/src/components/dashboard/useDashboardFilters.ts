import { useMemo, useState } from 'react';
import { statusesSharingLabel, type SubmissionStatus } from '@portal/shared';
import type { DashboardFilter } from '@/api/dashboard';

/** Current cost-provision month (YYYY-MM) in IST. */
export function currentMonth(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Shift a YYYY-MM month by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Months in [from, to] inclusive, newest first — options for the month picker. */
export function monthsInRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  for (let m = to; m >= from && out.length <= 240; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

/**
 * The dashboard filter state shared by the finance and clinic dashboards.
 *
 * SCOPE IS NOT THIS HOOK'S JOB. It holds selections and shapes them into query
 * payloads; WHICH clinics/SPOCs are selectable comes from `/dashboard/filters`,
 * which the API already narrows to the caller's `accessibleClinicIds`. Every read
 * and export endpoint re-intersects on the server, so a clinic role sending a
 * hand-edited clinic id gets denied there rather than trusted here. That is what
 * lets one hook serve a finance manager (all clinics) and a SPOC (one) unchanged.
 */
export interface DashboardFiltersState {
  clinicIds: Set<string> | null;
  setClinicIds: (next: Set<string> | null) => void;
  spocUserIds: Set<string> | null;
  setSpocUserIds: (next: Set<string> | null) => void;
  statuses: Set<SubmissionStatus> | null;
  setStatuses: (next: Set<SubmissionStatus> | null) => void;
  expenseHeadIds: Set<string> | null;
  setExpenseHeadIds: (next: Set<string> | null) => void;
  fromMonth: string;
  setFromMonth: (next: string) => void;
  toMonth: string;
  setToMonth: (next: string) => void;
  viewMonth: string;
  setViewMonth: (next: string) => void;

  /** The as-of month for the status tracker + variance. */
  asOf: string;
  /** True when a filter is explicitly emptied — nothing matches, render empty. */
  anyEmpty: boolean;
  /** Multi-select payload for the read endpoints. */
  rangeFilter: DashboardFilter;
  /** Single-value-or-all payload for the export endpoints. */
  exportFilter: DashboardFilter;
  /** Clinic-totals payload, narrowed to the focused month when one is picked. */
  clinicFilter: DashboardFilter;
  monthOptions: string[];
  effectiveMonth: string;
  soleClinicId: string | undefined;
  /** Lists (or undefined for "All") for the query keys and per-endpoint args. */
  clinicIdList: string[] | undefined;
  spocUserIdList: string[] | undefined;
  statusList: SubmissionStatus[] | undefined;
}

export function useDashboardFilters(): DashboardFiltersState {
  const thisMonth = currentMonth();
  // Multi-select filters (Clinic, SPOC, Status): `null` = All (the default); a Set
  // is the chosen subset. Empty is never reached — the control falls back to All.
  const [clinicIds, setClinicIds] = useState<Set<string> | null>(null);
  const [spocUserIds, setSpocUserIds] = useState<Set<string> | null>(null);
  const [statuses, setStatuses] = useState<Set<SubmissionStatus> | null>(null);
  const [expenseHeadIds, setExpenseHeadIds] = useState<Set<string> | null>(null);
  const [fromMonth, setFromMonth] = useState(shiftMonth(thisMonth, -11));
  const [toMonth, setToMonth] = useState(thisMonth);
  // Shared month focus for the trend, clinic-total and split cards. Empty = whole
  // range. `effectiveMonth` collapses to whole range if the pick leaves the range.
  const [viewMonth, setViewMonth] = useState('');

  // A `null` (All) selection sends nothing; a Set sends the chosen ids/statuses.
  const clinicIdList = clinicIds ? [...clinicIds] : undefined;
  const spocUserIdList = spocUserIds ? [...spocUserIds] : undefined;
  const expenseHeadIdList = expenseHeadIds ? [...expenseHeadIds] : undefined;
  // The Status filter offers one option per distinct LABEL, so a pick must be
  // expanded to every status behind that label before it reaches the API — picking
  // "Not Started" has to match DRAFT rows too, or half the clinics the user meant
  // would silently vanish from the results.
  const statusList = statuses
    ? [...new Set([...statuses].flatMap((s) => statusesSharingLabel(s)))]
    : undefined;

  // An explicitly emptied filter ("none" — every option unticked, incl. via the
  // "All" toggle) means NOTHING matches: the whole dashboard shows its empty state
  // until a selection is made (mirrors the expense-head 'none'), rather than
  // silently falling back to "all".
  const anyEmpty =
    (clinicIds !== null && clinicIds.size === 0) ||
    (spocUserIds !== null && spocUserIds.size === 0) ||
    (statuses !== null && statuses.size === 0) ||
    (expenseHeadIds !== null && expenseHeadIds.size === 0);

  // `toMonth` is the as-of month for the status tracker + variance; the pair
  // (from, to) bounds the trend charts.
  const asOf = toMonth || thisMonth;
  const rangeFilter: DashboardFilter = {
    clinicIds: clinicIdList,
    spocUserIds: spocUserIdList,
    expenseHeadIds: expenseHeadIdList,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: statusList,
  };

  // Exports are single-value-or-all by design (unchanged): pass a clinic / SPOC /
  // head id only when exactly one is selected, otherwise omit (all). Status lists
  // already flow through the export endpoints as-is. For a clinic role "all" is
  // already just their own clinics — the server resolves it from their scope.
  const soleClinicId = clinicIds && clinicIds.size === 1 ? [...clinicIds][0] : undefined;
  const soleSpocUserId = spocUserIds && spocUserIds.size === 1 ? [...spocUserIds][0] : undefined;
  const soleExpenseHeadId =
    expenseHeadIds && expenseHeadIds.size === 1 ? [...expenseHeadIds][0] : undefined;
  const exportFilter: DashboardFilter = {
    clinicId: soleClinicId,
    spocUserId: soleSpocUserId,
    expenseHeadId: soleExpenseHeadId,
    from: fromMonth || undefined,
    to: toMonth || undefined,
    status: statusList,
  };

  // Month-picker options + the effective pick (whole range when unset / out of range).
  const monthOptions = useMemo(() => monthsInRange(fromMonth, toMonth), [fromMonth, toMonth]);
  const effectiveMonth = viewMonth && monthOptions.includes(viewMonth) ? viewMonth : '';
  // Clinic totals honour the picked month by narrowing the fetched range to it.
  const clinicFilter: DashboardFilter = effectiveMonth
    ? { ...rangeFilter, from: effectiveMonth, to: effectiveMonth }
    : rangeFilter;

  return {
    clinicIds,
    setClinicIds,
    spocUserIds,
    setSpocUserIds,
    statuses,
    setStatuses,
    expenseHeadIds,
    setExpenseHeadIds,
    fromMonth,
    setFromMonth,
    toMonth,
    setToMonth,
    viewMonth,
    setViewMonth,
    asOf,
    anyEmpty,
    rangeFilter,
    exportFilter,
    clinicFilter,
    monthOptions,
    effectiveMonth,
    soleClinicId,
    clinicIdList,
    spocUserIdList,
    statusList,
  };
}

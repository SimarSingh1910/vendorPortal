import {
  SUBMISSION_STATUS_FILTER_OPTIONS,
  UserRole,
  type DashboardFilterOptions,
} from '@portal/shared';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/dashboard/MultiSelect';
import { useAuthStore } from '@/store/auth.store';
import type { DashboardFiltersState } from './useDashboardFilters';

// One option per DISTINCT status label. NOT_STARTED and DRAFT share the label
// "Not Started", so they collapse to a single option here; the hook expands the
// pick back to both enum values when it builds the query (see useDashboardFilters).
const statusItems = [...SUBMISSION_STATUS_FILTER_OPTIONS];

/**
 * The dashboard filter row — Clinic, Clinic SPOC, Expense head, Status, From/To
 * month — shared by the finance and clinic (SPOC / cluster manager) dashboards.
 *
 * ROLE SCOPING IS DATA, NOT MARKUP. EVERY dashboard renders the SAME six controls,
 * finance and clinic alike; the only thing that differs is the option lists, which
 * come straight from `/dashboard/filters` already narrowed to the caller's
 * accessible clinics. A finance manager's Clinic dropdown lists every clinic, a
 * cluster manager's lists their cluster, a SPOC's lists their own — from one
 * component, because the server decides the contents and re-checks them on every
 * read and export.
 *
 * Controls are not conditionally hidden on how MANY options they hold. An earlier
 * version suppressed the Clinic and SPOC filters at ≤1 option as "de-cluttering",
 * which in practice just made the clinic dashboards look broken next to the finance
 * one. A trivially-populated filter is honest and consistent; a missing one reads
 * as a missing feature.
 *
 * The ONE exception is by role, not by count: a CLINIC_SPOC never sees the Clinic
 * SPOC filter. Every submission they can see is their own, so the only option that
 * dropdown could ever offer is themselves — filtering by it is a guaranteed no-op.
 * A cluster manager keeps it, because their cluster genuinely spans several SPOCs
 * and narrowing to one is a real question to ask.
 */
export function DashboardFilterBar({
  options,
  filters,
}: {
  options: DashboardFilterOptions | undefined;
  filters: DashboardFiltersState;
}) {
  const role = useAuthStore((s) => s.user?.role);
  // Left at `null` ("All") for a SPOC, so hiding the control cannot narrow their
  // reads — it only removes a choice that had no effect.
  const showSpocFilter = role !== UserRole.CLINIC_SPOC;
  const showManagerFilter = role === UserRole.FINANCE_ADMIN || role === UserRole.FINANCE_MANAGER;

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${showManagerFilter ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
      <div className="space-y-1.5">
        <Label>Clinic</Label>
        <MultiSelect
          items={options?.clinics ?? []}
          selected={filters.clinicIds}
          onChange={filters.setClinicIds}
          nounSingular="clinic"
          nounPlural="clinics"
          ariaLabel="Filter by clinic"
          allowEmpty
          fullWidth
        />
      </div>
      {showSpocFilter && (
        <div className="space-y-1.5">
          <Label>Clinic SPOC</Label>
          <MultiSelect
            items={options?.spocs ?? []}
            selected={filters.spocUserIds}
            onChange={filters.setSpocUserIds}
            nounSingular="SPOC"
            nounPlural="SPOCs"
            ariaLabel="Filter by clinic SPOC"
            allowEmpty
            fullWidth
          />
        </div>
      )}
      {showManagerFilter && (
        <div className="space-y-1.5">
          <Label>Cluster manager</Label>
          <MultiSelect
            items={options?.managers ?? []}
            selected={filters.managerUserIds}
            onChange={filters.setManagerUserIds}
            nounSingular="manager"
            nounPlural="managers"
            ariaLabel="Filter by cluster manager"
            allowEmpty
            fullWidth
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Expense head</Label>
        <MultiSelect
          items={options?.expenseHeads ?? []}
          selected={filters.expenseHeadIds}
          onChange={filters.setExpenseHeadIds}
          nounSingular="head"
          nounPlural="heads"
          ariaLabel="Filter by expense head"
          allowEmpty
          fullWidth
        />
      </div>
      <div className="space-y-1.5">
        <Label>Status</Label>
        <MultiSelect
          items={statusItems}
          selected={filters.statuses}
          onChange={filters.setStatuses}
          nounSingular="status"
          nounPlural="statuses"
          ariaLabel="Filter by status"
          allowEmpty
          fullWidth
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="from">From month</Label>
        <MonthYearSelect id="from" value={filters.fromMonth} onChange={filters.setFromMonth} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="to">To month</Label>
        <MonthYearSelect id="to" value={filters.toMonth} onChange={filters.setToMonth} />
      </div>
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SELECT_CLASS =
  'h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * 'YYYY-MM' picker as separate Month + Year dropdowns — the native month input's
 * popup hides year navigation. An empty value shows (and edits from) this month.
 */
function MonthYearSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const [y, m] = (value || `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    .split('-')
    .map(Number);
  // ponytail: fixed window (5 years back, 1 ahead); widen if older data matters.
  const years = Array.from({ length: 7 }, (_, i) => thisYear - 5 + i);
  if (!years.includes(y)) years.unshift(y);
  const set = (year: number, month: number) =>
    onChange(`${year}-${String(month).padStart(2, '0')}`);
  return (
    <div className="flex gap-2">
      <select
        id={id}
        aria-label="Month"
        className={SELECT_CLASS}
        value={m}
        onChange={(e) => set(y, Number(e.target.value))}
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Year"
        className={SELECT_CLASS}
        value={y}
        onChange={(e) => set(Number(e.target.value), m)}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PortalTab, TAB_LABELS, UserRole, type NotificationConfigView } from '@portal/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listConfigs, upsertConfig } from '@/api/notificationConfig';
import { openCycle, type OpenCycleResult } from '@/api/submissions';
import { openCorpCycle, type OpenCorpCycleResult } from '@/api/corpSubmissions';
import { apiErrorMessage } from '@/lib/apiError';
import { formatIST, formatMonth } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

/** Current month in IST (UTC+5:30, no DST) as 'YYYY-MM' for the open-cycle default. */
function currentIstMonth(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const schema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM'),
  monthStartNotifyDate: z.string().min(1, 'Required'),
  cutoffDate: z.string().min(1, 'Required'),
  preCutoffReminderDays: z.coerce.number().int().min(0).max(60),
  varianceThresholdPercent: z.coerce.number().min(0).max(999.99),
});
type FormValues = z.input<typeof schema>;

/** A yyyy-mm-dd date input value → midnight UTC ISO; ISO → yyyy-mm-dd. */
const toIso = (date: string) => `${date}T00:00:00.000Z`;
const toDateInput = (iso: string) => iso.slice(0, 10);

/**
 * Per-cycle notification config for one portal. The same screen serves both tabs:
 * the Clinic tab mounts it with portal=CLINIC, the Corporate tab with
 * portal=CORPORATE, each editing only its own portal's independent config.
 */
export function NotificationConfigAdmin({ portal = PortalTab.CLINIC }: { portal?: PortalTab }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: configs = [] } = useQuery({
    queryKey: ['notification-config', portal],
    queryFn: () => listConfigs(portal),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      month: '',
      monthStartNotifyDate: '',
      cutoffDate: '',
      preCutoffReminderDays: 3,
      varianceThresholdPercent: 10,
    },
  });

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const parsed = schema.parse(values);
      return upsertConfig(
        parsed.month,
        {
          monthStartNotifyDate: toIso(parsed.monthStartNotifyDate),
          cutoffDate: toIso(parsed.cutoffDate),
          preCutoffReminderDays: parsed.preCutoffReminderDays,
          varianceThresholdPercent: parsed.varianceThresholdPercent,
        },
        portal,
      );
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['notification-config', portal] });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save config.')),
  });

  // Manual cycle open — separate from saving the config. Opening a month creates a
  // NOT_STARTED submission for every active clinic/department, which is what flips a
  // SPOC's "awaiting cycle open" screen into the data-entry form. Idempotent (the
  // same routine the scheduler runs on the notify date), and portal-aware.
  const isCorp = portal === PortalTab.CORPORATE;
  // Opening a cycle is Finance Admin only; the clinic config page is also visible to
  // the Finance Manager, so hide the control for them (backend enforces it too).
  const canOpenCycle = useAuthStore((s) => s.user?.role) === UserRole.FINANCE_ADMIN;
  const [openMonth, setOpenMonth] = useState(currentIstMonth);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openResult, setOpenResult] = useState<string | null>(null);

  const openCycleMutation = useMutation<OpenCycleResult | OpenCorpCycleResult, unknown, string>({
    mutationFn: (value: string) => (isCorp ? openCorpCycle(value) : openCycle(value)),
    onSuccess: (res) => {
      setOpenError(null);
      const count = 'activeClinics' in res ? res.activeClinics : res.activeDepartments;
      const noun = isCorp ? 'department' : 'clinic';
      setOpenResult(
        `${formatMonth(res.month)} is open — ${res.created} newly opened, ` +
          `${res.alreadyOpen} already open of ${count} active ${noun}${count === 1 ? '' : 's'}.`,
      );
      void qc.invalidateQueries({ queryKey: [isCorp ? 'corp' : 'submissions'] });
    },
    onError: (e) => {
      setOpenResult(null);
      setOpenError(apiErrorMessage(e, 'Could not open the cycle.'));
    },
  });
  const openMonthValid = MONTH_RE.test(openMonth);

  function editRow(config: NotificationConfigView) {
    reset({
      month: config.month,
      monthStartNotifyDate: toDateInput(config.monthStartNotifyDate),
      cutoffDate: toDateInput(config.cutoffDate),
      preCutoffReminderDays: config.preCutoffReminderDays,
      varianceThresholdPercent: Number(config.varianceThresholdPercent),
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Notification Config</h1>
        <p className="text-sm text-muted-foreground">
          Per-cycle schedule + variance threshold for{' '}
          <span className="font-medium text-foreground">{TAB_LABELS[portal]}</span>. This portal’s
          calendar is independent of the other. Finance Admin only.
        </p>
      </div>

      {canOpenCycle && (
      <div className="space-y-3 rounded-lg border p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Open cycle now</h2>
          <p className="text-sm text-muted-foreground">
            Open a month for data entry across every active {isCorp ? 'department' : 'clinic'} —
            creates each provision form and notifies its SPOCs. Safe to re-run; already-open{' '}
            {isCorp ? 'departments' : 'clinics'} are left untouched.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (openMonthValid) openCycleMutation.mutate(openMonth);
          }}
          className="flex flex-wrap items-end gap-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="openMonth">Month</Label>
            <Input
              id="openMonth"
              type="month"
              value={openMonth}
              onChange={(e) => setOpenMonth(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!openMonthValid || openCycleMutation.isPending}>
            {openCycleMutation.isPending ? 'Opening…' : 'Open cycle'}
          </Button>
        </form>
        {openResult && <p className="text-sm text-emerald-600 dark:text-emerald-400">{openResult}</p>}
        {openError && <p className="text-sm text-destructive">{openError}</p>}
      </div>
      )}

      <form
        onSubmit={handleSubmit((values) => saveMutation.mutate(values))}
        className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="month">Month (YYYY-MM)</Label>
          <Input id="month" type="month" {...register('month')} />
          {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="monthStartNotifyDate">Cycle open / notify date</Label>
          <Input id="monthStartNotifyDate" type="date" {...register('monthStartNotifyDate')} />
          {errors.monthStartNotifyDate && (
            <p className="text-xs text-destructive">{errors.monthStartNotifyDate.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cutoffDate">Cutoff date</Label>
          <Input id="cutoffDate" type="date" {...register('cutoffDate')} />
          {errors.cutoffDate && (
            <p className="text-xs text-destructive">{errors.cutoffDate.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preCutoffReminderDays">Pre-cutoff reminder (days)</Label>
          <Input
            id="preCutoffReminderDays"
            type="number"
            min="0"
            {...register('preCutoffReminderDays')}
          />
          {errors.preCutoffReminderDays && (
            <p className="text-xs text-destructive">{errors.preCutoffReminderDays.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="varianceThresholdPercent">Variance threshold (%)</Label>
          <Input
            id="varianceThresholdPercent"
            type="number"
            step="0.01"
            min="0"
            {...register('varianceThresholdPercent')}
          />
          {errors.varianceThresholdPercent && (
            <p className="text-xs text-destructive">{errors.varianceThresholdPercent.message}</p>
          )}
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save config'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{error}</p>}
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Notify date</TableHead>
              <TableHead>Cutoff</TableHead>
              <TableHead>Reminder (days)</TableHead>
              <TableHead>Variance %</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No config set yet.
                </TableCell>
              </TableRow>
            ) : (
              configs.map((config) => (
                <TableRow key={config.month}>
                  <TableCell className="font-medium">{formatMonth(config.month)}</TableCell>
                  <TableCell className="text-sm">{formatIST(config.monthStartNotifyDate)}</TableCell>
                  <TableCell className="text-sm">{formatIST(config.cutoffDate)}</TableCell>
                  <TableCell>{config.preCutoffReminderDays}</TableCell>
                  <TableCell>{config.varianceThresholdPercent}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => editRow(config)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

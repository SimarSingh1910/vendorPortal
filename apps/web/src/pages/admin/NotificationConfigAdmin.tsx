import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationConfigView } from '@portal/shared';
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
import { apiErrorMessage } from '@/lib/apiError';
import { formatIST, formatMonth } from '@/lib/format';

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

export function NotificationConfigAdmin() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: configs = [] } = useQuery({
    queryKey: ['notification-config'],
    queryFn: listConfigs,
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
      return upsertConfig(parsed.month, {
        monthStartNotifyDate: toIso(parsed.monthStartNotifyDate),
        cutoffDate: toIso(parsed.cutoffDate),
        preCutoffReminderDays: parsed.preCutoffReminderDays,
        varianceThresholdPercent: parsed.varianceThresholdPercent,
      });
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['notification-config'] });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save config.')),
  });

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
          Per-cycle schedule + variance threshold. Finance Admin only.
        </p>
      </div>

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

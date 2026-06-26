import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { getCurrentSec24, getSec24History, setSec24Allocation } from '@/api/corpSec24';
import { apiErrorMessage } from '@/lib/apiError';
import { formatIST, formatMonth } from '@/lib/format';

/** Default the effective-from month to the current IST month. */
function currentMonthIST(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

const schema = z.object({
  // 0 is a real, distinct allocation (0% ≠ "never set"); allow it explicitly.
  // valueAsNumber on the input feeds a real number (NaN when blank → caught here).
  allocationPct: z.number().min(0, 'Must be ≥ 0').max(100, 'Must be ≤ 100'),
  effectiveFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;

export function CorpSec24Admin() {
  const qc = useQueryClient();
  const { data: current, isLoading: currentLoading } = useQuery({
    queryKey: ['corp', 'sec24', 'current'],
    queryFn: getCurrentSec24,
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['corp', 'sec24', 'history'],
    queryFn: getSec24History,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { allocationPct: 0, effectiveFromMonth: currentMonthIST(), notes: '' },
  });

  const setMutation = useMutation({
    mutationFn: (values: FormValues) =>
      setSec24Allocation({
        allocationPct: values.allocationPct,
        effectiveFromMonth: values.effectiveFromMonth,
        notes: values.notes?.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['corp', 'sec24'] });
      reset({ allocationPct: 0, effectiveFromMonth: currentMonthIST(), notes: '' });
    },
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sec 24 allocation %</h1>
        <p className="text-sm text-muted-foreground">
          The HCL Avitas share applied to the shared-cost pool. Master data — Finance Admin only.
          The % is <span className="font-medium">append-only</span>: setting it records a new history
          row, never edits a past one. The % in effect for a month is the latest row whose effective
          month is on or before it; it is frozen onto each submission at approval.
        </p>
      </div>

      {/* Current allocation — clearly marked; "never set" shows as — (not 0%). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Current allocation</CardTitle>
          <CardDescription>The most recently set %.</CardDescription>
        </CardHeader>
        <CardContent>
          {currentLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : current ? (
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-semibold">{current.allocationPct}%</span>
              <span className="text-sm text-muted-foreground">
                effective from {formatMonth(current.effectiveFromMonth)} · set by{' '}
                {current.setBy.name} on {formatIST(current.setAt)}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-muted-foreground">—</span>
              <span className="text-sm text-muted-foreground">
                No allocation % has ever been set. The pool’s HCL Avitas share renders “—” until one
                is — this is distinct from a real 0%.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Set a new % — appends a new row. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Set a new allocation %</CardTitle>
          <CardDescription>
            Appends a new entry to the history below. 0% is a valid, distinct allocation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((values) => setMutation.mutate(values))}
            className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="allocationPct">Allocation %</Label>
              <Input
                id="allocationPct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                {...register('allocationPct', { valueAsNumber: true })}
              />
              {errors.allocationPct && (
                <p className="text-xs text-destructive">{errors.allocationPct.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveFromMonth">Effective from</Label>
              <Input id="effectiveFromMonth" type="month" {...register('effectiveFromMonth')} />
              {errors.effectiveFromMonth && (
                <p className="text-xs text-destructive">{errors.effectiveFromMonth.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" {...register('notes')} placeholder="e.g. FY26 revision" />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
            </div>
            <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={setMutation.isPending}>
                {setMutation.isPending ? 'Saving…' : 'Append allocation %'}
              </Button>
              {setMutation.isError && (
                <span className="text-sm text-destructive">
                  {apiErrorMessage(setMutation.error, 'Could not save. Please try again.')}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Append-only history — every past % as its own row, newest first. */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Allocation history</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Allocation %</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead>Set by</TableHead>
                <TableHead>Set at</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No allocation % has ever been set.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-right font-medium">
                      <span className="inline-flex items-center gap-2">
                        {row.allocationPct}%
                        {current?.id === row.id && <Badge variant="success">Current</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{formatMonth(row.effectiveFromMonth)}</TableCell>
                    <TableCell>{row.setBy.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatIST(row.setAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.notes ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

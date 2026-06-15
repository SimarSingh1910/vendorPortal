import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { listClinics } from '@/api/clinics';
import { listExpenseHeads } from '@/api/expenseHeads';
import { getMappedHeads, setMappings } from '@/api/mappings';
import { cn } from '@/lib/utils';

export function MappingsAdmin() {
  const qc = useQueryClient();
  const [clinicId, setClinicId] = useState<string>('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const { data: clinics = [] } = useQuery({
    queryKey: ['clinics', 'active'],
    queryFn: () => listClinics('active'),
  });
  const { data: heads = [] } = useQuery({
    queryKey: ['expense-heads', 'active'],
    queryFn: () => listExpenseHeads('active'),
  });
  const { data: mapped = [], isFetching: mappedLoading } = useQuery({
    queryKey: ['mapped', clinicId],
    queryFn: () => getMappedHeads(clinicId),
    enabled: !!clinicId,
  });

  // Seed the checkbox state from the clinic's current mapping.
  useEffect(() => {
    setChecked(new Set(mapped.map((m) => m.expenseHeadId)));
  }, [mapped]);

  const saveMutation = useMutation({
    mutationFn: () => setMappings(clinicId, [...checked]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mapped', clinicId] }),
  });

  const dirty = useMemo(() => {
    const current = new Set(mapped.map((m) => m.expenseHeadId));
    if (current.size !== checked.size) return true;
    for (const id of checked) if (!current.has(id)) return true;
    return false;
  }, [mapped, checked]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinic ↔ expense-head mapping</h1>
        <p className="text-sm text-muted-foreground">
          A head applies to a clinic only if mapped here. Unmapped clinics have an empty provision
          form. Finance Admin only.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="clinic" className="text-sm font-medium">
          Clinic
        </label>
        <select
          id="clinic"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={clinicId}
          onChange={(e) => setClinicId(e.target.value)}
        >
          <option value="">Select a clinic…</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.location}
            </option>
          ))}
        </select>
        {clinicId && (
          <Badge variant="secondary" data-testid="applies-count">
            Applies to provision form: {mappedLoading ? '…' : mapped.length}
          </Badge>
        )}
      </div>

      {!clinicId ? (
        <p className="text-sm text-muted-foreground">Select a clinic to manage its expense heads.</p>
      ) : heads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active expense heads. Create some under Expense Heads first.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border divide-y">
            {heads.map((head) => {
              const isChecked = checked.has(head.id);
              return (
                <label
                  key={head.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40',
                    isChecked && 'bg-muted/30',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={isChecked}
                    onChange={() => toggle(head.id)}
                    data-testid={`head-${head.id}`}
                  />
                  <span className="font-medium">{head.name}</span>
                  <span className="text-muted-foreground">{head.category}</span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save mapping'}
            </Button>
            {saveMutation.isSuccess && !dirty && (
              <span className="text-sm text-emerald-600">Saved.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

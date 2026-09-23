import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ActiveFilter, Clinic } from '@portal/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createClinic,
  deleteClinic,
  listClinics,
  setClinicActive,
  updateClinic,
  type ClinicInput,
} from '@/api/clinics';
import { apiErrorMessage } from '@/lib/apiError';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const clinicSchema = z.object({
  name: z.string().min(1, 'Required').max(191),
  accLocationCode: z.string().min(1, 'Required').max(191),
  customerCode: z.string().min(1, 'Required').max(191),
  customerName: z.string().min(1, 'Required').max(191),
});
type ClinicFormValues = z.infer<typeof clinicSchema>;

export function ClinicsAdmin() {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Clinic | null>(null);
  // Delete confirmation target; its error lives here because the row has no dialog of its own.
  const [deleteTarget, setDeleteTarget] = useState<Clinic | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: clinics = [], isLoading } = useQuery({
    queryKey: ['clinics', filter],
    queryFn: () => listClinics(filter),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['clinics'] });

  const [saveError, setSaveError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (values: ClinicInput) =>
      editing ? updateClinic(editing.id, values) : createClinic(values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (e) => setSaveError(apiErrorMessage(e, 'Could not save. Please try again.')),
  });

  // Row actions have no dialog of their own, so their failures surface here.
  const [rowError, setRowError] = useState<string | null>(null);
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setClinicActive(id, isActive),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (e) => setRowError(apiErrorMessage(e, 'Could not change status.')),
  });

  // A clinic with any history is refused with 409 — the server message tells the
  // admin to deactivate instead, so it is shown verbatim in the confirm dialog.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClinic(id),
    onSuccess: () => {
      setRowError(null);
      setDeleteTarget(null);
    },
    onError: (e) => setDeleteError(apiErrorMessage(e, 'Could not delete clinic.')),
    // Refetch on failure too: a 404 means someone else already removed the row,
    // and nothing else would clear the ghost (staleTime 30s, no focus refetch).
    // Assignments cascade away server-side, so cached user rows are stale too.
    onSettled: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  function openAdd() {
    setEditing(null);
    setSaveError(null);
    setDialogOpen(true);
  }
  function openEdit(clinic: Clinic) {
    setEditing(clinic);
    setSaveError(null);
    setDialogOpen(true);
  }
  function openDelete(clinic: Clinic) {
    setDeleteError(null);
    setDeleteTarget(clinic);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clinics</h1>
          <p className="text-sm text-muted-foreground">Master data — Finance Admin only.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus />
          Add clinic
        </Button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {rowError && (
        <p role="alert" className="text-sm text-destructive">
          {rowError}
        </p>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Acc. Location Code</TableHead>
              <TableHead>Customer Code</TableHead>
              <TableHead>Customer Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : clinics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No clinics.
                </TableCell>
              </TableRow>
            ) : (
              clinics.map((clinic) => (
                <TableRow key={clinic.id}>
                  <TableCell className="font-medium">{clinic.name}</TableCell>
                  <TableCell>{clinic.accLocationCode}</TableCell>
                  <TableCell>{clinic.customerCode}</TableCell>
                  <TableCell>{clinic.customerName}</TableCell>
                  <TableCell>
                    <Badge variant={clinic.isActive ? 'success' : 'muted'}>
                      {clinic.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghostPrimary" size="sm" onClick={() => openEdit(clinic)}>
                        Edit
                      </Button>
                      <Button
                        variant={clinic.isActive ? 'ghostDestructive' : 'ghostPrimary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: clinic.id, isActive: !clinic.isActive })
                        }
                      >
                        {clinic.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghostDestructive"
                        size="sm"
                        onClick={() => openDelete(clinic)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ClinicFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        pending={saveMutation.isPending}
        error={saveError}
        onSubmit={(values) => {
          setSaveError(null);
          saveMutation.mutate(values);
        }}
      />

      {/* Delete confirmation — a clinic with history is refused server-side (409). */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the clinic, its expense-head mappings, and its assignment
              from any user who also covers another clinic. It is only possible while the clinic has
              no submission history — otherwise deactivate it instead. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                setDeleteError(null);
                deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete clinic'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ClinicFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Clinic | null;
  pending: boolean;
  /** Server-side failure message, shown verbatim (409s explain themselves). */
  error: string | null;
  onSubmit: (values: ClinicFormValues) => void;
}

function ClinicFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  error,
  onSubmit,
}: ClinicFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClinicFormValues>({
    resolver: zodResolver(clinicSchema),
    defaultValues: {
      name: '',
      accLocationCode: '',
      customerCode: '',
      customerName: '',
    },
  });

  // Re-seed the form whenever the dialog opens (add = blank, edit = clinic).
  useEffect(() => {
    if (open) {
      reset(
        editing
          ? {
              name: editing.name,
              accLocationCode: editing.accLocationCode,
              customerCode: editing.customerCode,
              customerName: editing.customerName,
            }
          : { name: '', accLocationCode: '', customerCode: '', customerName: '' },
      );
    }
  }, [open, editing, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit clinic' : 'Add clinic'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update the clinic details.' : 'Create a new clinic.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accLocationCode">Acc. Location Code</Label>
            <Input id="accLocationCode" {...register('accLocationCode')} />
            {errors.accLocationCode && (
              <p className="text-xs text-destructive">{errors.accLocationCode.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerCode">Customer Code</Label>
            <Input id="customerCode" {...register('customerCode')} />
            {errors.customerCode && (
              <p className="text-xs text-destructive">{errors.customerCode.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerName">Customer Name</Label>
            <Input id="customerName" {...register('customerName')} />
            {errors.customerName && (
              <p className="text-xs text-destructive">{errors.customerName.message}</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

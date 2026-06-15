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
  listClinics,
  setClinicActive,
  updateClinic,
  type ClinicInput,
} from '@/api/clinics';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const clinicSchema = z.object({
  name: z.string().min(1, 'Required').max(191),
  location: z.string().min(1, 'Required').max(191),
  corporateClient: z.string().min(1, 'Required').max(191),
});
type ClinicFormValues = z.infer<typeof clinicSchema>;

export function ClinicsAdmin() {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Clinic | null>(null);
  const qc = useQueryClient();

  const { data: clinics = [], isLoading } = useQuery({
    queryKey: ['clinics', filter],
    queryFn: () => listClinics(filter),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['clinics'] });

  const saveMutation = useMutation({
    mutationFn: (values: ClinicInput) =>
      editing ? updateClinic(editing.id, values) : createClinic(values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setClinicActive(id, isActive),
    onSuccess: invalidate,
  });

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(clinic: Clinic) {
    setEditing(clinic);
    setDialogOpen(true);
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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Corporate client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : clinics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No clinics.
                </TableCell>
              </TableRow>
            ) : (
              clinics.map((clinic) => (
                <TableRow key={clinic.id}>
                  <TableCell className="font-medium">{clinic.name}</TableCell>
                  <TableCell>{clinic.location}</TableCell>
                  <TableCell>{clinic.corporateClient}</TableCell>
                  <TableCell>
                    <Badge variant={clinic.isActive ? 'success' : 'muted'}>
                      {clinic.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(clinic)}>
                        Edit
                      </Button>
                      <Button
                        variant={clinic.isActive ? 'destructive' : 'secondary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: clinic.id, isActive: !clinic.isActive })
                        }
                      >
                        {clinic.isActive ? 'Deactivate' : 'Activate'}
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
        isError={saveMutation.isError}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
    </div>
  );
}

interface ClinicFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Clinic | null;
  pending: boolean;
  isError: boolean;
  onSubmit: (values: ClinicFormValues) => void;
}

function ClinicFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  isError,
  onSubmit,
}: ClinicFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClinicFormValues>({
    resolver: zodResolver(clinicSchema),
    defaultValues: { name: '', location: '', corporateClient: '' },
  });

  // Re-seed the form whenever the dialog opens (add = blank, edit = clinic).
  useEffect(() => {
    if (open) {
      reset(
        editing
          ? { name: editing.name, location: editing.location, corporateClient: editing.corporateClient }
          : { name: '', location: '', corporateClient: '' },
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
            <Label htmlFor="location">Location</Label>
            <Input id="location" {...register('location')} />
            {errors.location && (
              <p className="text-xs text-destructive">{errors.location.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corporateClient">Corporate client</Label>
            <Input id="corporateClient" {...register('corporateClient')} />
            {errors.corporateClient && (
              <p className="text-xs text-destructive">{errors.corporateClient.message}</p>
            )}
          </div>
          {isError && <p className="text-sm text-destructive">Could not save. Please try again.</p>}
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

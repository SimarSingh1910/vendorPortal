import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { CorpDepartmentType, type ActiveFilter, type CorpDepartment } from '@portal/shared';
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
  createDepartment,
  listDepartments,
  setDepartmentActive,
  updateDepartment,
  type CorpDepartmentInput,
} from '@/api/departments';
import { DEPT_TYPE_LABELS } from '@/lib/corpFormat';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const deptSchema = z.object({
  name: z.string().min(1, 'Required').max(191),
  type: z.nativeEnum(CorpDepartmentType),
});
type DeptFormValues = z.infer<typeof deptSchema>;

export function CorpDepartmentsAdmin() {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CorpDepartment | null>(null);
  const qc = useQueryClient();

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['corp', 'admin', 'departments', filter],
    queryFn: () => listDepartments(filter),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['corp', 'admin', 'departments'] });

  const saveMutation = useMutation({
    mutationFn: (values: CorpDepartmentInput) =>
      editing ? updateDepartment(editing.id, values) : createDepartment(values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setDepartmentActive(id, isActive),
    onSuccess: invalidate,
  });

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(dept: CorpDepartment) {
    setEditing(dept);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate departments</h1>
          <p className="text-sm text-muted-foreground">
            Master data — Finance Admin only. Manage a department’s expense heads &amp; budget codes
            from its row.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus />
          Add department
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
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No departments.
                </TableCell>
              </TableRow>
            ) : (
              departments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell className="font-medium">{dept.name}</TableCell>
                  <TableCell>{DEPT_TYPE_LABELS[dept.type]}</TableCell>
                  <TableCell>
                    <Badge variant={dept.isActive ? 'success' : 'muted'}>
                      {dept.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/corporate/admin/departments/${dept.id}`}>Manage</Link>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(dept)}>
                        Edit
                      </Button>
                      <Button
                        variant={dept.isActive ? 'destructive' : 'secondary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: dept.id, isActive: !dept.isActive })
                        }
                      >
                        {dept.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DepartmentFormDialog
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

interface DepartmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CorpDepartment | null;
  pending: boolean;
  isError: boolean;
  onSubmit: (values: DeptFormValues) => void;
}

function DepartmentFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  isError,
  onSubmit,
}: DepartmentFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DeptFormValues>({
    resolver: zodResolver(deptSchema),
    defaultValues: { name: '', type: CorpDepartmentType.STANDARD },
  });

  useEffect(() => {
    if (open) {
      reset(
        editing
          ? { name: editing.name, type: editing.type }
          : { name: '', type: CorpDepartmentType.STANDARD },
      );
    }
  }, [open, editing, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit department' : 'Add department'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the department’s name or classification.'
              : 'Create a new corporate department.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              {...register('type')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Object.values(CorpDepartmentType).map((t) => (
                <option key={t} value={t}>
                  {DEPT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Shared cost pool (Sec 24) carries the HCL Avitas allocation %.
            </p>
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

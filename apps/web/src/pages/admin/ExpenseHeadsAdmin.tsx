import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ActiveFilter, ExpenseHead } from '@portal/shared';
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
  createExpenseHead,
  listExpenseHeads,
  setExpenseHeadActive,
  updateExpenseHead,
  type ExpenseHeadInput,
} from '@/api/expenseHeads';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const headSchema = z.object({
  name: z.string().min(1, 'Required').max(191),
  category: z.string().min(1, 'Required').max(191),
});
type HeadFormValues = z.infer<typeof headSchema>;

export function ExpenseHeadsAdmin() {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseHead | null>(null);
  const qc = useQueryClient();

  const { data: heads = [], isLoading } = useQuery({
    queryKey: ['expense-heads', filter],
    queryFn: () => listExpenseHeads(filter),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-heads'] });

  const saveMutation = useMutation({
    mutationFn: (values: ExpenseHeadInput) =>
      editing ? updateExpenseHead(editing.id, values) : createExpenseHead(values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setExpenseHeadActive(id, isActive),
    onSuccess: invalidate,
  });

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(head: ExpenseHead) {
    setEditing(head);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expense heads</h1>
          <p className="text-sm text-muted-foreground">Master data — Finance Admin only.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus />
          Add expense head
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
              <TableHead>Category</TableHead>
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
            ) : heads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No expense heads.
                </TableCell>
              </TableRow>
            ) : (
              heads.map((head) => (
                <TableRow key={head.id}>
                  <TableCell className="font-medium">{head.name}</TableCell>
                  <TableCell>{head.category}</TableCell>
                  <TableCell>
                    <Badge variant={head.isActive ? 'success' : 'muted'}>
                      {head.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(head)}>
                        Edit
                      </Button>
                      <Button
                        variant={head.isActive ? 'destructive' : 'secondary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: head.id, isActive: !head.isActive })
                        }
                      >
                        {head.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ExpenseHeadFormDialog
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

interface ExpenseHeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ExpenseHead | null;
  pending: boolean;
  isError: boolean;
  onSubmit: (values: HeadFormValues) => void;
}

function ExpenseHeadFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  isError,
  onSubmit,
}: ExpenseHeadFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HeadFormValues>({
    resolver: zodResolver(headSchema),
    defaultValues: { name: '', category: '' },
  });

  useEffect(() => {
    if (open) {
      reset(editing ? { name: editing.name, category: editing.category } : { name: '', category: '' });
    }
  }, [open, editing, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit expense head' : 'Add expense head'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update the expense-head details.' : 'Create a new expense head.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Input id="category" {...register('category')} />
            {errors.category && (
              <p className="text-xs text-destructive">{errors.category.message}</p>
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

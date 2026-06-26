import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import type { ActiveFilter } from '@portal/shared';
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
import { getDepartment } from '@/api/departments';
import {
  createCorpExpenseHead,
  listCorpExpenseHeads,
  setCorpExpenseHeadActive,
  updateCorpExpenseHead,
  type CorpExpenseHeadInput,
  type CorpExpenseHeadRow,
} from '@/api/corpExpenseHeads';
import {
  createCorpBudgetCode,
  listCorpBudgetCodes,
  setCorpBudgetCodeActive,
  updateCorpBudgetCode,
  type CorpBudgetCodeInput,
  type CorpBudgetCodeRow,
} from '@/api/corpBudgetCodes';
import { DEPT_TYPE_LABELS } from '@/lib/corpFormat';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

function FilterTabs({ value, onChange }: { value: ActiveFilter; onChange: (v: ActiveFilter) => void }) {
  return (
    <div className="flex gap-2">
      {FILTERS.map((f) => (
        <Button
          key={f.value}
          variant={value === f.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}

export function CorpDepartmentDetail() {
  const { departmentId = '' } = useParams();
  const { data: dept } = useQuery({
    queryKey: ['corp', 'admin', 'department', departmentId],
    queryFn: () => getDepartment(departmentId),
  });

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/corporate/admin/departments">
          <ArrowLeft />
          Back to departments
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dept?.name ?? 'Department'}</h1>
        {dept && (
          <p className="text-sm text-muted-foreground">
            {DEPT_TYPE_LABELS[dept.type]} ·{' '}
            <span className={dept.isActive ? '' : 'text-muted-foreground'}>
              {dept.isActive ? 'Active' : 'Inactive'}
            </span>{' '}
            — manage this department’s expense heads and budget codes.
          </p>
        )}
      </div>

      <ExpenseHeadsSection departmentId={departmentId} />
      <BudgetCodesSection departmentId={departmentId} />
    </div>
  );
}

// ── Expense heads ──────────────────────────────────────────────────────────────

const headSchema = z.object({ name: z.string().min(1, 'Required').max(191) });
type HeadFormValues = z.infer<typeof headSchema>;

function ExpenseHeadsSection({ departmentId }: { departmentId: string }) {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CorpExpenseHeadRow | null>(null);
  const qc = useQueryClient();

  const { data: heads = [], isLoading } = useQuery({
    queryKey: ['corp', 'admin', 'heads', departmentId, filter],
    queryFn: () => listCorpExpenseHeads(departmentId, filter),
  });
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['corp', 'admin', 'heads', departmentId] });

  const saveMutation = useMutation({
    mutationFn: (values: CorpExpenseHeadInput) =>
      editing
        ? updateCorpExpenseHead(departmentId, editing.id, values)
        : createCorpExpenseHead(departmentId, values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCorpExpenseHeadActive(departmentId, id, isActive),
    onSuccess: invalidate,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Expense heads</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          Add head
        </Button>
      </div>
      <FilterTabs value={filter} onChange={setFilter} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : heads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No expense heads.
                </TableCell>
              </TableRow>
            ) : (
              heads.map((head) => (
                <TableRow key={head.id}>
                  <TableCell className="font-medium">{head.name}</TableCell>
                  <TableCell>
                    <Badge variant={head.isActive ? 'success' : 'muted'}>
                      {head.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(head);
                          setDialogOpen(true);
                        }}
                      >
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

      <HeadFormDialog
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
    </section>
  );
}

function HeadFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  isError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CorpExpenseHeadRow | null;
  pending: boolean;
  isError: boolean;
  onSubmit: (values: HeadFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HeadFormValues>({ resolver: zodResolver(headSchema), defaultValues: { name: '' } });

  useEffect(() => {
    if (open) reset(editing ? { name: editing.name } : { name: '' });
  }, [open, editing, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit expense head' : 'Add expense head'}</DialogTitle>
          <DialogDescription>Heads are specific to this department.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="head-name">Name</Label>
            <Input id="head-name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
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

// ── Budget codes ────────────────────────────────────────────────────────────────

const codeSchema = z.object({
  code: z.string().min(1, 'Required').max(64),
  description: z.string().max(1000).optional(),
});
type CodeFormValues = z.infer<typeof codeSchema>;

function BudgetCodesSection({ departmentId }: { departmentId: string }) {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CorpBudgetCodeRow | null>(null);
  const qc = useQueryClient();

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['corp', 'admin', 'codes', departmentId, filter],
    queryFn: () => listCorpBudgetCodes(departmentId, filter),
  });
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['corp', 'admin', 'codes', departmentId] });

  const saveMutation = useMutation({
    mutationFn: (values: CorpBudgetCodeInput) =>
      editing
        ? updateCorpBudgetCode(departmentId, editing.id, values)
        : createCorpBudgetCode(departmentId, values),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
    },
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setCorpBudgetCodeActive(departmentId, id, isActive),
    onSuccess: invalidate,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Budget codes</h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          Add code
        </Button>
      </div>
      <FilterTabs value={filter} onChange={setFilter} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
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
            ) : codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No budget codes.
                </TableCell>
              </TableRow>
            ) : (
              codes.map((code) => (
                <TableRow key={code.id}>
                  <TableCell className="font-medium">{code.code}</TableCell>
                  <TableCell className="text-muted-foreground">{code.description ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={code.isActive ? 'success' : 'muted'}>
                      {code.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(code);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant={code.isActive ? 'destructive' : 'secondary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: code.id, isActive: !code.isActive })
                        }
                      >
                        {code.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CodeFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        pending={saveMutation.isPending}
        isError={saveMutation.isError}
        onSubmit={(values) =>
          saveMutation.mutate({ code: values.code, description: values.description || undefined })
        }
      />
    </section>
  );
}

function CodeFormDialog({
  open,
  onOpenChange,
  editing,
  pending,
  isError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CorpBudgetCodeRow | null;
  pending: boolean;
  isError: boolean;
  onSubmit: (values: CodeFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CodeFormValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '', description: '' },
  });

  useEffect(() => {
    if (open) {
      reset(
        editing
          ? { code: editing.code, description: editing.description ?? '' }
          : { code: '', description: '' },
      );
    }
  }, [open, editing, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit budget code' : 'Add budget code'}</DialogTitle>
          <DialogDescription>
            Codes are unique within this department and referenced by entries by id.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" {...register('code')} />
            {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code-desc">Description (optional)</Label>
            <Input id="code-desc" {...register('description')} />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
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

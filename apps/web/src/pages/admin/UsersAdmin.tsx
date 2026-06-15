import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  CLINIC_ROLES,
  ROLE_LABELS,
  UserRole,
  type ActiveFilter,
  type AdminUser,
} from '@portal/shared';
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
import { listClinics } from '@/api/clinics';
import {
  createUser,
  listUsers,
  setUserActive,
  updateUser,
  type CreateUserInput,
} from '@/api/users';
import { cn } from '@/lib/utils';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const isClinicRole = (role: UserRole) => (CLINIC_ROLES as readonly UserRole[]).includes(role);

export function UsersAdmin() {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', filter],
    queryFn: () => listUsers(filter),
  });
  const { data: clinics = [] } = useQuery({
    queryKey: ['clinics', 'active'],
    queryFn: () => listClinics('active'),
  });

  const clinicName = useMemo(
    () => new Map(clinics.map((c) => [c.id, c.name])),
    [clinics],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setUserActive(id, isActive),
    onSuccess: invalidate,
  });

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(user: AdminUser) {
    setEditing(user);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users &amp; access</h1>
          <p className="text-sm text-muted-foreground">
            Create users, assign one role, and map clinic-scoped users to clinics. Changes take
            effect immediately. Finance Admin only.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus />
          Add user
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
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Clinics</TableHead>
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
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No users.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {isClinicRole(user.role)
                      ? user.clinicIds.length === 0
                        ? '—'
                        : user.clinicIds.map((id) => clinicName.get(id) ?? id).join(', ')
                      : 'All (finance)'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'success' : 'muted'}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(user)}>
                        Edit
                      </Button>
                      <Button
                        variant={user.isActive ? 'destructive' : 'secondary'}
                        size="sm"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: user.id, isActive: !user.isActive })
                        }
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        clinics={clinics}
        onSaved={() => {
          invalidate();
          setDialogOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AdminUser | null;
  clinics: { id: string; name: string; location: string }[];
  onSaved: () => void;
}

function UserFormDialog({ open, onOpenChange, editing, clinics, onSaved }: UserFormDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.CLINIC_SPOC);
  const [clinicIds, setClinicIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword('');
    if (editing) {
      setName(editing.name);
      setEmail(editing.email);
      setRole(editing.role);
      setClinicIds(new Set(editing.clinicIds));
    } else {
      setName('');
      setEmail('');
      setRole(UserRole.CLINIC_SPOC);
      setClinicIds(new Set());
    }
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const clinics = isClinicRole(role) ? [...clinicIds] : [];
      if (editing) {
        return updateUser(editing.id, {
          name,
          role,
          clinicIds: clinics,
          ...(password ? { password } : {}),
        });
      }
      const input: CreateUserInput = { name, email, password, role, clinicIds: clinics };
      return createUser(input);
    },
    onSuccess: onSaved,
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
        'Could not save user.';
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Name is required.');
    if (!editing && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError('Valid email required.');
    if (!editing && password.length < 8) return setError('Password must be at least 8 characters.');
    if (editing && password && password.length < 8)
      return setError('Password must be at least 8 characters.');
    saveMutation.mutate();
  }

  function toggleClinic(id: string) {
    setClinicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'Add user'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the user. Role / clinic / password changes take effect immediately and end the user’s current session.'
              : 'Create a new user with exactly one role.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              value={email}
              disabled={!!editing}
              onChange={(e) => setEmail(e.target.value)}
            />
            {editing && <p className="text-xs text-muted-foreground">Email can’t be changed.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-password">
              Password {editing && <span className="text-muted-foreground">(leave blank to keep)</span>}
            </Label>
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Role</Label>
            <select
              id="u-role"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {Object.values(UserRole).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {isClinicRole(role) ? (
            <div className="space-y-1.5">
              <Label>Assigned clinics</Label>
              {clinics.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active clinics to assign.</p>
              ) : (
                <div className="max-h-40 overflow-auto rounded-md border divide-y">
                  {clinics.map((c) => (
                    <label
                      key={c.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40',
                        clinicIds.has(c.id) && 'bg-muted/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={clinicIds.has(c.id)}
                        onChange={() => toggleClinic(c.id)}
                        data-testid={`clinic-${c.id}`}
                      />
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">{c.location}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Finance roles have org-wide access (no clinic assignment).
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

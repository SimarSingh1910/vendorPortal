import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  CLINIC_ROLES,
  DEPT_SCOPED_ROLES,
  PortalTab,
  ROLE_LABELS,
  rolesForTab,
  TAB_LABELS,
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
import { listDepartments } from '@/api/departments';
import {
  createUser,
  listUsers,
  setUserActive,
  updateUser,
  type CreateUserInput,
} from '@/api/users';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const isClinicRole = (role: UserRole) => (CLINIC_ROLES as readonly UserRole[]).includes(role);
const isDeptRole = (role: UserRole) => (DEPT_SCOPED_ROLES as readonly UserRole[]).includes(role);

/** The two split admin views; FINANCE_ADMIN (cross-tab) appears in BOTH lists. */
const PORTAL_TABS: { value: PortalTab; label: string }[] = [
  { value: PortalTab.CLINIC, label: TAB_LABELS[PortalTab.CLINIC] },
  { value: PortalTab.CORPORATE, label: TAB_LABELS[PortalTab.CORPORATE] },
];

/** The sensible default role when adding a user from a portal's view. */
const defaultRoleFor = (portal: PortalTab) =>
  portal === PortalTab.CORPORATE ? UserRole.DEPT_SPOC : UserRole.CLINIC_SPOC;

/**
 * Users & access. The same screen serves both tabs over the SAME user table:
 * `defaultPortal` selects which portal's list opens first (Clinic from the clinic
 * tab, Corporate from the corporate tab); the toggle still switches between them.
 */
export function UsersAdmin({ defaultPortal = PortalTab.CLINIC }: { defaultPortal?: PortalTab } = {}) {
  const [portal, setPortal] = useState<PortalTab>(defaultPortal);
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', filter, portal],
    queryFn: () => listUsers(filter, portal),
  });
  const { data: clinics = [] } = useQuery({
    queryKey: ['clinics', 'active'],
    queryFn: () => listClinics('active'),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments('active'),
  });

  const clinicName = useMemo(
    () => new Map(clinics.map((c) => [c.id, c.name])),
    [clinics],
  );
  const departmentName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
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
            Viewing <span className="font-medium text-foreground">{TAB_LABELS[portal]}</span> users.
            Create users, assign one role, and map each clinic- or department-scoped user to one or
            more clinics / departments. Changes take effect immediately. Finance Admin only.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus />
          Add user
        </Button>
      </div>

      {/* Clinic vs Corporate split over the SAME user table. Finance Admin (the one
          cross-tab account) shows in BOTH lists, labelled so it isn't mistaken for a duplicate. */}
      <div className="flex gap-2 border-b pb-3">
        {PORTAL_TABS.map((t) => (
          <Button
            key={t.value}
            variant={portal === t.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPortal(t.value)}
          >
            {t.label}
          </Button>
        ))}
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
              <TableHead>Clinic / Department</TableHead>
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
                      : isDeptRole(user.role)
                        ? user.departmentIds.length === 0
                          ? '—'
                          : user.departmentIds.map((id) => departmentName.get(id) ?? id).join(', ')
                        : user.role === UserRole.FINANCE_ADMIN
                          ? 'All — Finance Admin (both portals)'
                          : 'All (finance)'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'success' : 'muted'}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghostPrimary" size="sm" onClick={() => openEdit(user)}>
                        Edit
                      </Button>
                      <Button
                        variant={user.isActive ? 'ghostDestructive' : 'ghostPrimary'}
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
        portal={portal}
        clinics={clinics}
        departments={departments}
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
  /** Which portal's view opened this dialog — drives the role options offered. */
  portal: PortalTab;
  clinics: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  onSaved: () => void;
}

function UserFormDialog({
  open,
  onOpenChange,
  editing,
  portal,
  clinics,
  departments,
  onSaved,
}: UserFormDialogProps) {
  // Creating from a portal view offers only that portal's roles (FINANCE_ADMIN, the
  // cross-tab account, is in both). When editing, keep the user's own role listed.
  const roleOptions = useMemo(() => {
    const opts = rolesForTab(portal);
    if (editing && !opts.includes(editing.role)) return [editing.role, ...opts];
    return opts;
  }, [portal, editing]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(defaultRoleFor(portal));
  // One or more clinics per clinic-role user; finance roles carry none.
  const [clinicIds, setClinicIds] = useState<string[]>([]);
  // One or more departments per Dept SPOC/Viewer; all other roles carry none.
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleClinic = (id: string) =>
    setClinicIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  const toggleDepartment = (id: string) =>
    setDepartmentIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword('');
    if (editing) {
      setName(editing.name);
      setEmail(editing.email);
      setRole(editing.role);
      setClinicIds(editing.clinicIds ?? []);
      setDepartmentIds(editing.departmentIds ?? []);
    } else {
      setName('');
      setEmail('');
      setRole(defaultRoleFor(portal));
      setClinicIds([]);
      setDepartmentIds([]);
    }
  }, [open, editing, portal]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const clinics = isClinicRole(role) ? clinicIds : [];
      const depts = isDeptRole(role) ? departmentIds : [];
      if (editing) {
        return updateUser(editing.id, {
          name,
          role,
          clinicIds: clinics,
          departmentIds: depts,
          ...(password ? { password } : {}),
        });
      }
      const input: CreateUserInput = {
        name,
        email,
        password,
        role,
        clinicIds: clinics,
        departmentIds: depts,
      };
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
    if (isClinicRole(role) && clinicIds.length === 0)
      return setError('Select at least one clinic for clinic-scoped roles.');
    if (isDeptRole(role) && departmentIds.length === 0)
      return setError('Select at least one department for department-scoped roles.');
    saveMutation.mutate();
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
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                  {r === UserRole.FINANCE_ADMIN ? ' (both portals)' : ''}
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
                <>
                  <div
                    className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2"
                    data-testid="clinic-select"
                  >
                    {clinics.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={clinicIds.includes(c.id)}
                          onChange={() => toggleClinic(c.id)}
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Clinic-scoped users may cover one or more clinics ({clinicIds.length} selected).
                  </p>
                </>
              )}
            </div>
          ) : isDeptRole(role) ? (
            <div className="space-y-1.5">
              <Label>Assigned departments</Label>
              {departments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active departments to assign.</p>
              ) : (
                <>
                  <div
                    className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2"
                    data-testid="department-select"
                  >
                    {departments.map((d) => (
                      <label
                        key={d.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={departmentIds.includes(d.id)}
                          onChange={() => toggleDepartment(d.id)}
                        />
                        <span>{d.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Department-scoped users may cover one or more departments (
                    {departmentIds.length} selected).
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Finance &amp; Corporate Finance Manager roles have tab-wide access (no individual
              clinic or department assignment).
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

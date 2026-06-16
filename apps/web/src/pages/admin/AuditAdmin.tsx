import { Fragment, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download } from 'lucide-react';
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
import { listClinics } from '@/api/clinics';
import { listUsers } from '@/api/users';
import { exportAudit, getAuditActions, searchAudit, type AuditFilter } from '@/api/audit';
import { formatIST } from '@/lib/format';

const PAGE_SIZE = 25;

/** A native, Input-styled select for the filter row. */
function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </select>
  );
}

/** Convert a yyyy-mm-dd date input to a UTC day boundary ISO string. */
function dayBoundary(date: string, end: boolean): string | undefined {
  if (!date) return undefined;
  return `${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;
}

export function AuditAdmin() {
  const [clinicId, setClinicId] = useState('');
  const [performedById, setPerformedById] = useState('');
  const [action, setAction] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Reset to page 1 whenever a filter changes.
  const setFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const filter: AuditFilter = {
    clinicId: clinicId || undefined,
    performedById: performedById || undefined,
    action: action || undefined,
    from: dayBoundary(fromDate, false),
    to: dayBoundary(toDate, true),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data: clinics = [] } = useQuery({ queryKey: ['clinics', 'all'], queryFn: () => listClinics('all') });
  const { data: users = [] } = useQuery({ queryKey: ['users', 'all'], queryFn: () => listUsers('all') });
  const { data: actions = [] } = useQuery({ queryKey: ['audit', 'actions'], queryFn: getAuditActions });

  const { data, isLoading } = useQuery({
    queryKey: ['audit', filter],
    queryFn: () => searchAudit(filter),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleExport() {
    setExporting(true);
    try {
      await exportAudit({ ...filter, page: undefined, pageSize: undefined });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Append-only trail of every change. Finance Admin only.
          </p>
        </div>
        <Button onClick={handleExport} disabled={exporting || total === 0}>
          <Download />
          {exporting ? 'Exporting…' : 'Export .xlsx'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label>Clinic</Label>
          <Select value={clinicId} onChange={(v) => setFilter(() => setClinicId(v))}>
            <option value="">All clinics</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>User</Label>
          <Select value={performedById} onChange={(v) => setFilter(() => setPerformedById(v))}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Action</Label>
          <Select value={action} onChange={(v) => setFilter(() => setAction(v))}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" type="date" value={fromDate} onChange={(e) => setFilter(() => setFromDate(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={toDate} onChange={(e) => setFilter(() => setToDate(e.target.value))} />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp (IST)</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Clinic</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No audit entries match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const hasChange = row.oldValue != null || row.newValue != null;
                const isOpen = expanded === row.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className={hasChange ? 'cursor-pointer' : ''}
                      onClick={() => hasChange && setExpanded(isOpen ? null : row.id)}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatIST(row.performedAt)}
                      </TableCell>
                      <TableCell>{row.performedByName ?? 'SYSTEM'}</TableCell>
                      <TableCell className="font-medium">{row.action}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.entityType}
                        <span className="block text-xs">{row.entityId}</span>
                      </TableCell>
                      <TableCell>{row.clinicName ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.ipAddress ?? '—'}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${row.id}-detail`}>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium text-muted-foreground">Old</div>
                              <pre className="overflow-auto rounded bg-background p-2 text-xs">
                                {row.oldValue != null ? JSON.stringify(row.oldValue, null, 2) : '—'}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-medium text-muted-foreground">New</div>
                              <pre className="overflow-auto rounded bg-background p-2 text-xs">
                                {row.newValue != null ? JSON.stringify(row.newValue, null, 2) : '—'}
                              </pre>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

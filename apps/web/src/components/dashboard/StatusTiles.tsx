import { User } from 'lucide-react';
import type { DashboardStatusTile } from '@portal/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatINR, statusBadgeVariant, statusLabel } from '@/lib/format';

/**
 * Color-coded current-month status tiles, one per active in-scope clinic. The
 * badge colour comes from the shared status→variant map so it matches the rest
 * of the app.
 *
 * For finance roles each tile also names the clinic's SPOC(s) — who to chase when
 * a month is sitting unstarted. The API only populates `spocNames` for those
 * roles, so a clinic user's tiles are unchanged (they'd just be reading their own
 * name back). A finance tile with an empty list means the clinic currently has NO
 * active SPOC, which is worth surfacing rather than hiding.
 */
export function StatusTiles({ tiles }: { tiles: DashboardStatusTile[] }) {
  if (tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">No active clinics in scope.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.clinicId}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium leading-tight">{tile.clinicName}</span>
              <Badge variant={statusBadgeVariant(tile.status)}>{statusLabel(tile.status)}</Badge>
            </div>
            <SpocLine names={tile.spocNames} />
            <div className="text-sm text-muted-foreground">
              {tile.total != null ? formatINR(tile.total) : 'No entry yet'}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * The clinic's SPOC(s) on a finance tile.
 *
 * Renders NOTHING when the list is absent — that is a clinic-scoped viewer, for
 * whom the API deliberately sends no names. An EMPTY list on a finance view is a
 * different thing entirely: the clinic has no active SPOC, so it says so.
 */
function SpocLine({ names }: { names: string[] | null }) {
  if (!names) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <User className="size-3.5 shrink-0" aria-hidden />
      {names.length > 0 ? (
        <span className="truncate" title={names.join(', ')}>
          {names.join(', ')}
        </span>
      ) : (
        <span className="italic">No SPOC assigned</span>
      )}
    </div>
  );
}

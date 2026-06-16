import type { DashboardStatusTile } from '@portal/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatINR, statusBadgeVariant, statusLabel } from '@/lib/format';

/**
 * Color-coded current-month status tiles, one per active in-scope clinic. The
 * badge colour comes from the shared status→variant map so it matches the rest
 * of the app.
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
            <div className="text-sm text-muted-foreground">
              {tile.total != null ? formatINR(tile.total) : 'No entry yet'}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

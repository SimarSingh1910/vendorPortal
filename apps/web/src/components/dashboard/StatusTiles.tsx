import { useState } from 'react';
import { User } from 'lucide-react';
import { SubmissionStatus, type DashboardStatusTile } from '@portal/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatINR, statusBadgeVariant, statusLabel } from '@/lib/format';

/**
 * Where a clinic's month sits RELATIVE TO THE FINANCE MANAGER — the finance
 * dashboard's three buckets. Purely a way of reading the existing status; no
 * status value, card or workflow rule is affected.
 */
type FinanceGroup = 'approved' | 'inReview' | 'upstream';

/**
 * Every submission status, bucketed. Typed as an EXHAUSTIVE Record so adding a
 * status to the enum fails the build here rather than silently dropping those
 * clinics out of all three columns.
 *
 * Only the two finance-owned states are singled out; everything else is still
 * upstream of finance and lands in `upstream`, which is the safe default — a card
 * shown as "not yet with finance" is honest about work outstanding, whereas one
 * wrongly shown as approved is not.
 *
 * SENT_BACK_BY_FINANCE is the one judgement call: it HAS been on the finance
 * manager's desk, but they pushed it back, so right now it is neither approved nor
 * in review with them — it is the clinic's to fix and re-send. It therefore goes
 * to `upstream` alongside SENT_BACK_BY_MANAGER.
 */
const GROUP_BY_STATUS: Record<SubmissionStatus, FinanceGroup> = {
  [SubmissionStatus.FINANCE_APPROVED]: 'approved',
  [SubmissionStatus.FINANCE_REVIEW]: 'inReview',
  [SubmissionStatus.NOT_STARTED]: 'upstream',
  [SubmissionStatus.DRAFT]: 'upstream',
  [SubmissionStatus.SUBMITTED]: 'upstream',
  [SubmissionStatus.CLINIC_MANAGER_REVIEW]: 'upstream',
  [SubmissionStatus.CLINIC_APPROVED]: 'upstream',
  [SubmissionStatus.SENT_BACK_BY_MANAGER]: 'upstream',
  [SubmissionStatus.SENT_BACK_BY_FINANCE]: 'upstream',
};

/**
 * Left → right, with the headings exactly as the finance manager asked for them.
 * They read as short stage labels because the whole board is already the finance
 * manager's view — "approved"/"in review"/"not provided" are implicitly BY them.
 */
const GROUPS: ReadonlyArray<{ key: FinanceGroup; heading: string; tintFrom: SubmissionStatus }> = [
  { key: 'approved', heading: 'approved', tintFrom: SubmissionStatus.FINANCE_APPROVED },
  { key: 'inReview', heading: 'in review', tintFrom: SubmissionStatus.FINANCE_REVIEW },
  // The upstream bucket spans several statuses, so it takes its tone from the most
  // representative one — NOT_STARTED, the state most "not provided" clinics are
  // actually in. That resolves to the same neutral chip tint those clinics carry.
  { key: 'upstream', heading: 'not provided', tintFrom: SubmissionStatus.NOT_STARTED },
];

/**
 * Tile tint per badge variant, using the SAME design tokens `badge.tsx` gives the
 * status chips — `--success` #DCFCE7 / #166534, `--warning` #FEF3C7 / #92400E,
 * `--muted` #EEF2F8 / #47505C. No new colour constants: a group's tint is looked up
 * through `statusBadgeVariant` from the status that DEFINES that group, so if a
 * chip colour ever changes the tiles follow it automatically instead of drifting
 * into a second, stale palette.
 *
 * Every variant is covered (not just the three in use) so the lookup is total and
 * a future re-mapping of a status to, say, `error` still renders a sane tile.
 */
const TILE_TINT: Record<NonNullable<BadgeProps['variant']>, string> = {
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  error: 'bg-error text-error-foreground',
  muted: 'bg-muted text-muted-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  default: 'bg-primary text-primary-foreground',
  outline: 'bg-card text-foreground',
};

/** The chip tint that a group's defining status already uses. */
function tintFor(status: SubmissionStatus): string {
  return TILE_TINT[statusBadgeVariant(status) ?? 'muted'];
}

/**
 * The bucket for a status. Falls back to `upstream` for anything the map doesn't
 * know — the status arrives as JSON from the API, so a value added server-side
 * before this client is rebuilt would otherwise vanish from the board entirely.
 */
function groupOf(status: DashboardStatusTile['status']): FinanceGroup {
  return GROUP_BY_STATUS[status] ?? 'upstream';
}

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
 *
 * `grouped` renders the SAME tiles as the finance board's three COLLAPSIBLE group
 * tiles (see GROUP_BY_STATUS). It changes placement only — identical cards,
 * identical chips — and is off by default so the SPOC/manager dashboard, which has
 * no finance-manager perspective to take, keeps its plain responsive grid.
 *
 * Used by BOTH finance roles: FINANCE_ADMIN and FINANCE_MANAGER share one
 * `/finance/dashboard` route (FINANCE_FULL in auth/roles.ts), so there is one
 * board and both see these tiles — no per-role duplication to keep in step.
 */
export function StatusTiles({
  tiles,
  grouped = false,
}: {
  tiles: DashboardStatusTile[];
  grouped?: boolean;
}) {
  if (tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">No active clinics in scope.</p>;
  }

  if (!grouped) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <StatusTile key={tile.clinicId} tile={tile} />
        ))}
      </div>
    );
  }

  return <GroupedStatusTiles tiles={tiles} />;
}

/**
 * The finance board: three compact, status-tinted TILES — heading + count — that
 * open ONE SHARED CENTERED MODAL listing the clinics in the chosen bin.
 *
 * WHY A MODAL RATHER THAN AN ANCHORED PANEL. Earlier revisions expanded the group
 * inline (which stretched the other two tiles, since grid rows size to their
 * tallest cell) and then into a panel anchored under its tile (which overlapped the
 * KPI and chart cards below). A portalled dialog sidesteps both: it is rendered at
 * the document root, so it can neither reflow the row nor be clipped by, or collide
 * with, anything on the dashboard.
 *
 * The tiles are now PURELY TRIGGERS — nothing about the row changes when one is
 * clicked. The modal carries a bin dropdown, so switching between Approved / In
 * review / Not provided swaps the list in place rather than forcing a close-reopen
 * round trip.
 *
 * Grouping is unchanged and still exhaustive: every tile lands in exactly one
 * group, so the three counts always sum to `tiles.length` and no clinic is lost.
 */
function GroupedStatusTiles({ tiles }: { tiles: DashboardStatusTile[] }) {
  // `null` = closed; otherwise the bin the modal is showing. One piece of state
  // drives both "is it open" and "which list", so the dropdown and the tile that
  // opened it can never disagree.
  const [openGroup, setOpenGroup] = useState<FinanceGroup | null>(null);

  const counts = GROUPS.map(({ key }) => ({
    key,
    items: tiles.filter((t) => groupOf(t.status) === key),
  }));
  const active = counts.find((c) => c.key === openGroup);
  const activeMeta = GROUPS.find((g) => g.key === openGroup);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {GROUPS.map(({ key, heading, tintFrom }) => {
          const inGroup = counts.find((c) => c.key === key)!.items;
          return (
            // The whole tile is the control, so the click target is the card rather
            // than a small icon. The tint is the status chip's own.
            <button
              key={key}
              type="button"
              onClick={() => setOpenGroup(key)}
              aria-haspopup="dialog"
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left shadow-sm transition-[filter] hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                tintFor(tintFrom),
              )}
            >
              <span className="space-y-0.5">
                <span className="block text-xs font-medium uppercase tracking-wide opacity-80">
                  {heading}
                </span>
                {/* The count is the headline figure, in the status colour. */}
                <span className="block text-2xl font-semibold leading-none tabular-nums">
                  {inGroup.length}
                </span>
              </span>
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">View</span>
            </button>
          );
        })}
      </div>

      {/*
        The app's shared shadcn/Radix Dialog — which is what gives us, for free and
        without a bespoke implementation: a portal (so it floats above every card),
        the dimmed scrim, a focus trap, Escape-to-close, click-outside-to-close, and
        focus restored to the tile that opened it. `DialogContent` already renders
        the × button in its top-right corner.
      */}
      <Dialog open={openGroup !== null} onOpenChange={(next) => !next && setOpenGroup(null)}>
        {/* The count line below the title is the description, so Radix's separate
            DialogDescription is deliberately unused — declaring that explicitly
            keeps its a11y warning off the console. */}
        <DialogContent
          aria-describedby={undefined}
          // Sized for the real case: a "not provided" bin can hold dozens of
          // clinics, so the window is wide enough for a two-column list and tall
          // enough to show several rows before scrolling — while still clearly a
          // dialog rather than a takeover of the page.
          className="flex max-h-[80vh] w-[92vw] max-w-3xl flex-col gap-3 overflow-hidden p-4"
        >
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="space-y-1">
              <DialogTitle className="text-base">Clinics by status</DialogTitle>
              {activeMeta && active && (
                <p className="text-sm text-muted-foreground">
                  <span className="capitalize">{activeMeta.heading}</span> ·{' '}
                  {active.items.length} {active.items.length === 1 ? 'clinic' : 'clinics'}
                </p>
              )}
            </div>
          </div>

          {/* Switching bins swaps the list in place — no close/reopen. Native
              select, matching the dashboard's other filter controls. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              aria-label="Status group"
              value={openGroup ?? ''}
              onChange={(e) => setOpenGroup(e.target.value as FinanceGroup)}
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm capitalize shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {GROUPS.map(({ key, heading }) => (
                <option key={key} value={key} className="capitalize">
                  {heading}
                </option>
              ))}
            </select>
          </label>

          {/* Two columns of COMPACT cards, so a long bin stays scannable instead of
              becoming one very long scroll. The dashboard's own grid keeps the
              full-size cards — only this dense list uses the compact variant. */}
          <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
            {active && active.items.length === 0 ? (
              // An empty bin is still selectable — the finance manager should be
              // able to confirm "nothing here", not just infer it from a 0 tile.
              <p className="text-sm text-muted-foreground">None</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {active?.items.map((tile) => (
                  <StatusTile key={tile.clinicId} tile={tile} compact />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One clinic's tile. Identical DATA in both sizes — name, status chip, SPOC(s) and
 * the amount (or "No entry yet"; NULL ≠ 0 either way).
 *
 * `compact` is for the modal's dense two-column list, where a bin may hold dozens
 * of clinics: tighter padding, one line for the name, and the amount pulled up
 * beside the chip instead of onto its own row. That roughly halves the row height,
 * so far more clinics fit before scrolling. The dashboard's own grid keeps the
 * roomier default.
 */
function StatusTile({ tile, compact = false }: { tile: DashboardStatusTile; compact?: boolean }) {
  const amount = tile.total != null ? formatINR(tile.total) : 'No entry yet';

  if (compact) {
    return (
      <Card>
        <CardContent className="space-y-1 p-2.5">
          <div className="flex items-start justify-between gap-2">
            {/* One line here — the list is scanned, not read, and the full name
                stays available on hover. */}
            <span className="truncate text-sm font-medium leading-tight" title={tile.clinicName}>
              {tile.clinicName}
            </span>
            <Badge className="shrink-0" variant={statusBadgeVariant(tile.status)}>
              {statusLabel(tile.status)}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            {/* min-w-0 lets a long SPOC list actually truncate inside the flex row;
                the wrapper still holds its place when SpocLine renders nothing (a
                clinic-scoped viewer), so the amount stays right-aligned either way. */}
            <div className="min-w-0 flex-1">
              <SpocLine names={tile.spocNames} />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{amount}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          {/* Capped at two lines so the card has a known MAXIMUM height. The full
              name stays available on hover. */}
          <span className="line-clamp-2 font-medium leading-tight" title={tile.clinicName}>
            {tile.clinicName}
          </span>
          <Badge className="shrink-0" variant={statusBadgeVariant(tile.status)}>
            {statusLabel(tile.status)}
          </Badge>
        </div>
        <SpocLine names={tile.spocNames} />
        <div className="text-sm text-muted-foreground">{amount}</div>
      </CardContent>
    </Card>
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

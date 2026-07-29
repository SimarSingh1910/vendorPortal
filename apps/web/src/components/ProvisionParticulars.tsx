import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatINR } from '@/lib/format';
import {
  minorToAmountString,
  particularValueMinor,
  type ParticularDraft,
} from '@/lib/provisionLines';

interface ParticularsTableProps {
  particulars: ParticularDraft[];
  /** When false the rows render as read-only text (review / locked / non-SPOC). */
  editable: boolean;
  /**
   * Whether the row SET may change. False for the Manager/Finance override, which
   * may retype an existing particular but not add or drop rows — that stays the
   * SPOC's. Ignored when `editable` is false.
   */
  allowAddRemove?: boolean;
  onPatch: (index: number, patch: Partial<ParticularDraft>) => void;
  onAdd: () => void;
  /** Called only for a removable row — the LAST remaining particular never is. */
  onRemove: (index: number) => void;
}

/**
 * The Particular / Rate / Quantity / Value sub-table nested under ONE vendor line.
 *
 * Value is strictly derived — rendered, never an input — and recomputed on every
 * keystroke from the same shared fixed-decimal maths the server uses on save, so
 * the number the user watches is the number that gets stored. A row missing a rate
 * or quantity shows "—", not "₹0.00": incomplete is not zero.
 *
 * Every vendor line keeps AT LEAST ONE particular, so the remove control is hidden
 * on the last remaining row rather than left to fail on click.
 */
export function ParticularsTable({
  particulars,
  editable,
  allowAddRemove = true,
  onPatch,
  onAdd,
  onRemove,
}: ParticularsTableProps) {
  const showRowControls = editable && allowAddRemove;
  // Min one: the last remaining particular of a vendor line is never removable.
  const canRemove = showRowControls && particulars.length > 1;

  return (
    <div className="rounded-md border border-border/60 bg-background/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-xs text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Particular</th>
            <th className="w-32 px-2 py-1.5 text-right font-medium">Rate</th>
            <th className="w-28 px-2 py-1.5 text-right font-medium">Quantity</th>
            <th className="w-36 px-2 py-1.5 text-right font-medium">Value (₹)</th>
            {showRowControls && <th className="w-10 px-2 py-1.5" aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {particulars.map((p, pi) => {
            const value = minorToAmountString(particularValueMinor(p));
            return (
              <tr key={p.particularId ?? `new-${pi}`} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-1.5">
                  {editable ? (
                    <Input
                      type="text"
                      placeholder="What is being provisioned"
                      className="h-8"
                      value={p.name}
                      onChange={(e) => onPatch(pi, { name: e.target.value })}
                    />
                  ) : (
                    <span className={cn(!p.name && 'text-muted-foreground')}>{p.name || '—'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {editable ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.0001"
                      inputMode="decimal"
                      className="h-8 text-right"
                      value={p.rate}
                      onChange={(e) => onPatch(pi, { rate: e.target.value })}
                    />
                  ) : (
                    <span className={cn(!p.rate && 'text-muted-foreground')}>{p.rate || '—'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {editable ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      className="h-8 text-right"
                      value={p.quantity}
                      onChange={(e) => onPatch(pi, { quantity: e.target.value })}
                    />
                  ) : (
                    <span className={cn(!p.quantity && 'text-muted-foreground')}>
                      {p.quantity || '—'}
                    </span>
                  )}
                </td>
                {/* Derived — deliberately not an input in either mode. */}
                <td
                  className={cn(
                    'px-2 py-1.5 text-right tabular-nums',
                    value === null && 'text-muted-foreground',
                  )}
                >
                  {formatINR(value)}
                </td>
                {showRowControls && (
                  <td className="px-1 py-1.5 text-right">
                    {canRemove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label="Remove this particular"
                        onClick={() => onRemove(pi)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showRowControls && (
        <div className="border-t border-border/60 px-1 py-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={onAdd}
          >
            <Plus className="size-3.5" />
            Add particular
          </Button>
        </div>
      )}
    </div>
  );
}

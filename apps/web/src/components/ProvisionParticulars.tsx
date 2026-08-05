import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldErrorText } from '@/components/FieldError';
import { INVALID_FIELD_CLASS, fieldErrorTextId } from '@/lib/fieldErrors';
import { cn } from '@/lib/utils';
import { formatINR } from '@/lib/format';
import {
  minorToAmountString,
  particularValueMinor,
  type ParticularDraft,
} from '@/lib/provisionLines';

/** The three required inputs on a particular row. */
export type ParticularFieldKind = 'name' | 'rate' | 'quantity';

interface ParticularsTableProps {
  particulars: ParticularDraft[];
  /** When false the rows render as read-only text (review / locked / non-SPOC). */
  editable: boolean;
  /**
   * Supplies each required input's DOM id and, once a submit has been blocked, its
   * "you must fill this in" message. Omitted on the review screens, which don't
   * submit — the rows then render exactly as before, with no ids and no markers.
   */
  fieldMeta?: (
    particularIndex: number,
    kind: ParticularFieldKind,
  ) => { id: string; error?: string };
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
 * The Particular / Rate / Quantity / Value / Remark sub-table nested under ONE
 * vendor line.
 *
 * Value is strictly derived — rendered, never an input — and recomputed on every
 * keystroke from the same shared fixed-decimal maths the server uses on save, so
 * the number the user watches is the number that gets stored. A row missing a rate
 * or quantity shows "—", not "₹0.00": incomplete is not zero.
 *
 * Remark is the SPOC's optional per-row explanation (it used to be one textarea per
 * vendor line, above). It is SPOC-OWNED: a reviewer override may retype figures but
 * reads the remark read-only, so it is editable only when the row set is also the
 * caller's to change (`allowAddRemove`) — the same rule as vendor name / product
 * code. Blank stays blank; it is never filled with a placeholder.
 *
 * Every vendor line keeps AT LEAST ONE particular, so the remove control is hidden
 * on the last remaining row rather than left to fail on click.
 */
export function ParticularsTable({
  particulars,
  editable,
  fieldMeta,
  allowAddRemove = true,
  onPatch,
  onAdd,
  onRemove,
}: ParticularsTableProps) {
  // No `fieldMeta` (the review screens) → no ids and nothing ever marked.
  const meta = (pi: number, kind: ParticularFieldKind) => fieldMeta?.(pi, kind);
  const showRowControls = editable && allowAddRemove;
  // Min one: the last remaining particular of a vendor line is never removable.
  const canRemove = showRowControls && particulars.length > 1;
  // The remark belongs to the SPOC: a reviewer sees it, never types in it.
  const remarkEditable = editable && allowAddRemove;

  return (
    <div className="rounded-md border border-border/60 bg-background/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-xs text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Particular</th>
            <th className="w-32 px-2 py-1.5 text-right font-medium">Rate</th>
            <th className="w-28 px-2 py-1.5 text-right font-medium">Quantity</th>
            <th className="w-36 px-2 py-1.5 text-right font-medium">Value (₹)</th>
            {/* Sits on the right, in the width freed by dropping the head-level
                note textarea from the G/L Account Name column. */}
            <th className="w-64 px-2 py-1.5 text-left font-medium">Remark</th>
            {showRowControls && <th className="w-10 px-2 py-1.5" aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {particulars.map((p, pi) => {
            const value = minorToAmountString(particularValueMinor(p));
            const nameF = meta(pi, 'name');
            const rateF = meta(pi, 'rate');
            const qtyF = meta(pi, 'quantity');
            return (
              <tr key={p.particularId ?? `new-${pi}`} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-1.5 align-top">
                  {editable ? (
                    <>
                      <Input
                        id={nameF?.id}
                        type="text"
                        placeholder="What is being provisioned"
                        className={cn('h-8 scroll-mt-28', nameF?.error && INVALID_FIELD_CLASS)}
                        aria-invalid={nameF?.error ? true : undefined}
                        aria-describedby={
                          nameF?.error ? fieldErrorTextId(nameF.id) : undefined
                        }
                        value={p.name}
                        onChange={(e) => onPatch(pi, { name: e.target.value })}
                      />
                      {nameF && (
                        <FieldErrorText id={fieldErrorTextId(nameF.id)} message={nameF.error} />
                      )}
                    </>
                  ) : (
                    <span className={cn(!p.name && 'text-muted-foreground')}>{p.name || '—'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right align-top">
                  {editable ? (
                    <>
                      <Input
                        id={rateF?.id}
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        className={cn(
                          'h-8 scroll-mt-28 text-right',
                          rateF?.error && INVALID_FIELD_CLASS,
                        )}
                        aria-invalid={rateF?.error ? true : undefined}
                        aria-describedby={
                          rateF?.error ? fieldErrorTextId(rateF.id) : undefined
                        }
                        value={p.rate}
                        onChange={(e) => onPatch(pi, { rate: e.target.value })}
                      />
                      {rateF && (
                        <FieldErrorText
                          id={fieldErrorTextId(rateF.id)}
                          message={rateF.error}
                          className="text-left"
                        />
                      )}
                    </>
                  ) : (
                    <span className={cn(!p.rate && 'text-muted-foreground')}>{p.rate || '—'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right align-top">
                  {editable ? (
                    <>
                      <Input
                        id={qtyF?.id}
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        className={cn(
                          'h-8 scroll-mt-28 text-right',
                          qtyF?.error && INVALID_FIELD_CLASS,
                        )}
                        aria-invalid={qtyF?.error ? true : undefined}
                        aria-describedby={qtyF?.error ? fieldErrorTextId(qtyF.id) : undefined}
                        value={p.quantity}
                        onChange={(e) => onPatch(pi, { quantity: e.target.value })}
                      />
                      {qtyF && (
                        <FieldErrorText
                          id={fieldErrorTextId(qtyF.id)}
                          message={qtyF.error}
                          className="text-left"
                        />
                      )}
                    </>
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
                {/* Optional, free text, one per particular — a compact inline input,
                    not a textarea: it annotates this row, it isn't a document. */}
                <td className="px-2 py-1.5">
                  {remarkEditable ? (
                    <Input
                      type="text"
                      placeholder="Remark (optional) — e.g. why it changed"
                      className="h-8"
                      value={p.remark}
                      onChange={(e) => onPatch(pi, { remark: e.target.value })}
                    />
                  ) : (
                    <span
                      className={cn(
                        'whitespace-pre-wrap',
                        !p.remark && 'text-muted-foreground',
                      )}
                    >
                      {p.remark || '—'}
                    </span>
                  )}
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

/**
 * Fixed-decimal money maths for clinic particulars (rate × quantity = value) and
 * the derived sums above them. Shared by the API and the web app so the figure the
 * SPOC watches update while typing is computed by the SAME code that the server
 * later persists — the UI and the DB can never disagree by a rounding step.
 *
 * Everything is done in INTEGER MINOR UNITS (bigint), never in floating point:
 * rates carry 4 dp and quantities 3 dp, so `0.1 * 3` style binary drift would
 * otherwise show up in a finance total. A JS `number` is only ever used at the
 * edges (an input the user typed, bounded and dp-capped by validation); all
 * arithmetic in between is exact.
 *
 * NULL ≠ 0 throughout. A blank rate/quantity yields a NULL value, a NULL value
 * makes its vendor line's amount NULL, and a NULL line amount makes its head's
 * amount NULL. Incomplete never silently becomes ₹0 — it stays incomplete and
 * blocks submit.
 */

/** Decimal places each figure is stored with (mirrors the Prisma column scales). */
export const RATE_DECIMALS = 4;
export const QUANTITY_DECIMALS = 3;
export const VALUE_DECIMALS = 2;

/** DECIMAL(14,2) ceiling, in paise — the largest value/amount any sum may reach. */
export const MAX_VALUE_MINOR = 99_999_999_999_999n; // 999,999,999,999.99

/**
 * Exact `10 ** n` as a bigint (no `Math.pow` float step).
 */
function pow10(n: number): bigint {
  let out = 1n;
  for (let i = 0; i < n; i++) out *= 10n;
  return out;
}

/**
 * A user-entered number → integer minor units at `decimals` places.
 *
 * The single float→int boundary in this module. Validation caps both the
 * magnitude and the decimal places before anything reaches here, so the scaled
 * product stays far inside the exact-integer range of a double and `Math.round`
 * lands on the intended unit rather than papering over real precision loss.
 */
export function toMinorUnits(value: number, decimals: number): bigint {
  return BigInt(Math.round(value * Number(pow10(decimals))));
}

/** Integer minor units → a fixed-point decimal string, e.g. 123456n → "1234.56". */
export function minorToDecimalString(minor: bigint, decimals: number = VALUE_DECIMALS): string {
  const scale = pow10(decimals);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = decimals === 0 ? '' : `.${frac.toString().padStart(decimals, '0')}`;
  return `${negative ? '-' : ''}${whole}${fracStr}`;
}

/**
 * value = rate × quantity, in paise, rounded HALF-UP to 2 decimal places.
 *
 * Rate (4 dp) × quantity (3 dp) is an exact integer product at 7 dp; rounding it
 * to paise is the ONLY rounding step in the whole chain, and it happens once, per
 * particular, before storage. Every sum above this is therefore an exact sum of
 * stored values — which is what makes the head amount tie out to the penny
 * against the database.
 *
 * Half-up (0.005 → 0.01) is the convention finance staff expect from a manual
 * calculation, and since rate and quantity are both non-negative (enforced by
 * validation) "add a half unit then truncate" is exactly half-up.
 *
 * Returns null when either input is blank — an incomplete particular has no value,
 * it does NOT have a value of zero.
 */
export function computeValueMinor(rate: number | null, quantity: number | null): bigint | null {
  if (rate === null || quantity === null) return null;

  const rateMinor = toMinorUnits(rate, RATE_DECIMALS);
  const qtyMinor = toMinorUnits(quantity, QUANTITY_DECIMALS);
  // Product carries RATE_DECIMALS + QUANTITY_DECIMALS places; reduce it to
  // VALUE_DECIMALS, rounding half-up.
  const divisor = pow10(RATE_DECIMALS + QUANTITY_DECIMALS - VALUE_DECIMALS);
  return (rateMinor * qtyMinor + divisor / 2n) / divisor;
}

/**
 * Sum a set of derived figures, propagating incompleteness.
 *
 * Returns null when the set is EMPTY or when ANY member is null — a vendor line
 * with a half-filled particular has no trustworthy subtotal, so it reports "no
 * amount yet" rather than a partial sum that looks like a real (but too small)
 * figure. This is the rule that keeps incomplete drafts out of dashboards and
 * exports, both of which filter on `amount IS NOT NULL`.
 */
export function sumMinor(parts: Array<bigint | null>): bigint | null {
  if (parts.length === 0) return null;
  let total = 0n;
  for (const part of parts) {
    if (part === null) return null;
    total += part;
  }
  return total;
}

/** Convenience: parse a stored DECIMAL string ("1234.56") back to minor units. */
export function decimalStringToMinor(
  value: string,
  decimals: number = VALUE_DECIMALS,
): bigint | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  if (frac.length > decimals) return null;
  const scaled = BigInt(whole) * pow10(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return sign === '-' ? -scaled : scaled;
}

/**
 * Fixed, predefined Product Code options for a clinic provision line.
 *
 * SINGLE SOURCE OF TRUTH: the SPOC dropdown (web) and the API's allowed-set
 * validation both read this list, so the options and the server's accepted set
 * can't drift. Adding/removing a value later = edit this one constant (no DB
 * enum migration; the entry column is a validated nullable string).
 *
 * NOT an admin-managed master (the values are fixed for now) and NOT snapshotted.
 * Clinic-only — a corporate provision line carries a budget code and a free-text
 * location instead, so there is no second portal to keep in step.
 *
 * The STORED value is the bare code (`P27`); the dropdown renders
 * `productCodeLabel()` ("P27 - NCV / VAS") so the SPOC picks by meaning rather
 * than by memorising numbers. Codes are UPPERCASE, matching the finance sheet.
 */
export const PRODUCT_CODES = ['P27', 'P21', 'P20', 'P18', 'P17', 'P10'] as const;

/** A valid Product Code value (one of PRODUCT_CODES). */
export type ProductCode = (typeof PRODUCT_CODES)[number];

/**
 * What each code means, from the finance sheet. Keyed by ProductCode, so adding a
 * code to PRODUCT_CODES without describing it here is a compile error — the list
 * and its labels cannot drift apart.
 */
export const PRODUCT_CODE_DESCRIPTIONS: Record<ProductCode, string> = {
  P27: 'NCV / VAS',
  P21: 'Dental Rental',
  P20: 'CC / OHC',
  P18: 'EHC / PHC',
  P17: 'Health Check',
  P10: 'Care Plan',
};

/**
 * The dropdown label for a code: "P27 - NCV / VAS".
 *
 * Tolerant of a value that isn't in the list — a historical row whose code was
 * later retired still renders as its bare code rather than as a blank cell.
 */
export function productCodeLabel(code: string): string {
  const description = PRODUCT_CODE_DESCRIPTIONS[code as ProductCode];
  return description ? `${code} - ${description}` : code;
}

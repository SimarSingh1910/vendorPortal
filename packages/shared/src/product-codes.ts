/**
 * Fixed, predefined Product Code options for a clinic provision line.
 *
 * SINGLE SOURCE OF TRUTH: the SPOC dropdown (web) and the API's allowed-set
 * validation both read this list, so the options and the server's accepted set
 * can't drift. Adding/removing a value later = edit this one constant (no DB
 * enum migration; the entry column is a validated nullable string).
 *
 * NOT an admin-managed master (the values are fixed for now) and NOT snapshotted.
 */
export const PRODUCT_CODES = ['p10', 'p18', 'p20', 'p17'] as const;

/** A valid Product Code value (one of PRODUCT_CODES). */
export type ProductCode = (typeof PRODUCT_CODES)[number];

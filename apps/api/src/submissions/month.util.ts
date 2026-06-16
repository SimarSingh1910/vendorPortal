/** Shared month helpers. Months are `YYYY-MM` strings in IST (the business TZ). */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

/**
 * The current cost-provision month in IST (UTC+5:30). Timestamps are stored UTC
 * but the cycle/month is a business date, so it must be derived in IST — e.g.
 * 2026-07-01 02:00 UTC is already July 1st 07:30 IST.
 */
export function currentMonthIST(now: Date = new Date()): string {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

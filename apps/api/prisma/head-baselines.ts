/**
 * Typical monthly provision per expense head, keyed by G/L ACCOUNT NUMBER.
 *
 * Used ONLY to bootstrap a clinic that has no history to model on — the first time
 * a month is seeded for a freshly imported clinic there is nothing to copy forward,
 * and `seed-month.ts` will not invent a figure without a source. Once a clinic has
 * one populated month, that month becomes the template and these numbers stop being
 * consulted for it.
 *
 * The G/L numbers, account names, vendors and product codes are the REAL ones from
 * the finance sheet — no `TEMP-`/`PENDING-` placeholders. `base` is a plausible
 * monthly rupee figure for a mid-sized clinic; `seed-month.ts` scales it per clinic
 * so no two clinics report identical numbers.
 *
 * Vendor name AND product code are both mandatory at submit (BR-03), so every entry
 * carries both. `vendor2` exists only for heads flagged multi-vendor, which get a
 * second, smaller line so multi-line data is exercised.
 */
export interface HeadBaseline {
  /** Monthly rupee figure before per-clinic scaling. */
  base: number;
  vendor: string;
  product: string;
  /** Second vendor line, for heads that allow several. */
  vendor2?: string;
  /** Optional SPOC remark, seeded on the first particular only. */
  description?: string;
}

export const HEAD_BASELINES: Record<string, HeadBaseline> = {
  '41002007': { base: 90_000, vendor: 'Medanta Locum Services', product: 'P17', vendor2: 'Apollo Locum Pool' },
  '41003001': { base: 40_000, vendor: 'Sodexo BRS India', product: 'P20' },
  '41103001': { base: 12_000, vendor: 'Airtel Business', product: 'P18', description: 'Bandwidth upgrade' },
  '41104002': { base: 80_000, vendor: 'Romsons Scientific & Surgical', product: 'P17' },
  '41104016': { base: 55_000, vendor: 'Siemens Healthineers', product: 'P27', description: 'Scheduled AMC for imaging equipment' },
  '41107001': { base: 120_000, vendor: 'Prestige Property Management', product: 'P21', vendor2: 'Brigade Facilities', description: 'Annual lease escalation 5% effective Apr' },
  '41109004': { base: 18_000, vendor: 'UClean', product: 'P20' },
  '41112001': { base: 20_000, vendor: 'Cvent India', product: 'P27', vendor2: 'Local Event Partners', description: 'Quarterly community health camp' },
  '41115002': { base: 25_000, vendor: 'BVG India Ltd', product: 'P20', description: 'Additional deep-clean contract' },
  '41115009': { base: 5_000, vendor: 'Blue Dart', product: 'P10' },
  '41115013': { base: 12_000, vendor: 'Nestle Professional', product: 'P18' },
  '41117001': { base: 30_000, vendor: 'Ziqitza Healthcare', product: 'P27' },
  '41117002': { base: 15_000, vendor: 'SembRamky Environmental', product: 'P17' },
  '41117004': { base: 60_000, vendor: 'Quess Corp', product: 'P20', vendor2: 'Sodexo Facilities' },
  '41402005': { base: 8_000, vendor: 'Pine Labs', product: 'P10', description: 'Two additional POS terminals installed' },
};

/**
 * Stable per-clinic multiplier in roughly 0.75–1.30, derived from the clinic id so
 * the same clinic always scales the same way across runs and months. Without this
 * every clinic would report byte-identical figures, which makes the clinic-wise
 * comparison and the variance chart meaningless.
 */
export function clinicFactor(clinicId: string): number {
  let h = 0;
  for (let i = 0; i < clinicId.length; i += 1) h = (h * 31 + clinicId.charCodeAt(i)) >>> 0;
  return 0.75 + (h % 56) / 100;
}

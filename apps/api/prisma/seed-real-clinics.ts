/**
 * REAL clinic master data — imports the org's actual clinic list, SPOCs and cluster
 * managers from a spreadsheet, replacing the invented demo clinics.
 *
 * Run from apps/api:
 *   pnpm prisma:seed:real                              # reads every workbook in prisma/data
 *   pnpm prisma:seed:real -- --file=../../Book2.xlsx   # or an explicit path
 *   pnpm prisma:seed:real -- --file=a.xlsx --file=b.xlsx   # repeatable
 *   pnpm prisma:seed:real -- --dry-run                 # parse + report, write nothing
 *
 * SOURCE COLUMNS (row 1 is the header), located BY HEADER TEXT, not by position:
 *   Customer Code · Acc. location Code · Customer Name · Location Name
 *   Clinic SPOC (provision entry provider) · Approver — Cluster Manager
 *
 * The workbooks do not agree on column order — `clinics.xlsx` leads with Customer
 * Code, `additional-clinics.xlsx` with Acc. location Code — and both codes are
 * non-empty strings, so reading by position would silently swap the two identifiers
 * on one of them. Hence the header lookup, and a hard error naming any file whose
 * header is missing a column rather than a half-read row.
 *
 * ALL SOURCES ARE IMPORTED IN ONE PASS. This is load-bearing, not a convenience:
 * duplicate location names are disambiguated by appending the customer name, and
 * that comparison can only see the rows in front of it. Four locations (Greater
 * Noida Knowledge Park, Bengaluru Marathahalli, Mumbai, Noida Sec 24) appear in BOTH
 * workbooks under different customers — importing the files in separate runs would
 * leave each pair rendering identically on the dashboard, tiles and exports.
 *
 * WHAT IT REPLACES. The demo clinics and the demo clinic-role logins are deleted;
 * deleting a clinic cascades its submissions, entries and particulars, which is why
 * the users can then be removed at all (ProvisionEntry.enteredById is Restrict, not
 * Cascade — a user with surviving entries cannot be deleted). Finance accounts, the
 * expense-head master and the whole corporate side are left untouched, as is any
 * clinic that this seed did not create (e.g. one added by hand in the admin UI).
 *
 * MASTERS ONLY — NO PROVISION FIGURES. The spreadsheet carries no amounts, so none
 * are invented: every new clinic opens with "No entry yet" rather than a fabricated
 * ₹0 (NULL ≠ 0). Use `pnpm prisma:seed:month` afterwards if you want a populated
 * month, though note it models each clinic on its own prior data and these clinics
 * have none yet.
 *
 * Everything is written through the real services (ClinicsService, UsersService,
 * ClinicExpenseHeadsService), so every clinic, user and mapping is audit-logged
 * exactly as if a Finance Admin had entered it. Boots the Nest application context,
 * so the app must be compiled first; the pnpm script runs `nest build` for you.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaClient, UserRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';

const dist = createRequire(__filename);
const { AppModule } = dist('../app.module');
const { PrismaService } = dist('../prisma/prisma.service');
const { ClinicsService } = dist('../clinics/clinics.service');
const { UsersService } = dist('../users/users.service');
const { ClinicExpenseHeadsService } = dist('../clinic-expense-heads/clinic-expense-heads.service');

function loadEnv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env'),
    join(__dirname, '..', '..', '.env'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// Dev passwords, by role — the same ones every other seeded account uses.
const SPOC_PASSWORD = 'Spoc@12345';
const MANAGER_PASSWORD = 'Manager@12345';

/** The demo clinics this seed supersedes (seed-demo.ts's invented set). */
const DEMO_CLINIC_NAMES = [
  'Pune Tech Park Clinic',
  'Mumbai BKC Clinic',
  'Bengaluru Whitefield Clinic',
  'Hyderabad Gachibowli Clinic',
  'Chennai OMR Clinic',
  'Gurugram Cyber City Clinic (closed)',
];

/** Collapse runs of whitespace and trim — the sheet is full of trailing spaces. */
const norm = (v: unknown): string => {
  const raw =
    v && typeof v === 'object'
      ? ((v as { richText?: { text: string }[]; text?: string; result?: unknown }).richText
          ?.map((r) => r.text)
          .join('') ??
        (v as { text?: string }).text ??
        String((v as { result?: unknown }).result ?? ''))
      : String(v ?? '');
  return raw.replace(/\s+/g, ' ').trim();
};

/**
 * Email local-part from a real name: drop an honorific, then take the FIRST and
 * LAST name tokens ("Mukesh Kumar Pandey" → mukesh.pandey). Middle names are
 * dropped because they make addresses unwieldy without adding distinctness, and the
 * full name is preserved verbatim as the display name regardless.
 */
function emailSlug(name: string): string {
  const cleaned = name
    .replace(/^\s*(dr|mr|mrs|ms)\.?\s*/i, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter(Boolean);
  const picked = parts.length <= 2 ? parts : [parts[0], parts[parts.length - 1]];
  return picked.join('.').toLowerCase();
}

interface SheetRow {
  customerCode: string;
  accLocationCode: string;
  customerName: string;
  locationName: string;
  spoc: string;
  manager: string;
}

/** The workbooks that make up the master list, in a stable order. */
const DEFAULT_SOURCES = ['clinics.xlsx', 'additional-clinics.xlsx'];

function sourceFiles(): string[] {
  const args = process.argv
    .filter((a) => a.startsWith('--file='))
    .map((a) => a.slice('--file='.length))
    .map((a) => (isAbsolute(a) ? a : resolve(process.cwd(), a)));
  if (args.length > 0) {
    const missing = args.filter((p) => !existsSync(p));
    if (missing.length > 0) {
      throw new Error(`Source workbook not found:\n  ${missing.join('\n  ')}`);
    }
    return args;
  }

  // Default: every known workbook that is actually present. `~$…` files are Excel's
  // lock files for an open workbook, never data.
  const dirs = [join(process.cwd(), 'prisma', 'data'), join(__dirname, '..', '..', 'prisma', 'data')];
  const dir = dirs.find((d) => existsSync(d));
  const found = dir
    ? DEFAULT_SOURCES.map((f) => join(dir, f)).filter(
        (p) => existsSync(p) && !/[\\/]~\$/.test(p),
      )
    : [];
  if (found.length === 0) {
    throw new Error(
      `No source workbook found. Looked for ${DEFAULT_SOURCES.join(', ')} in:\n  ${dirs.join('\n  ')}\nPass --file=<path>.`,
    );
  }
  return found;
}

/**
 * Column positions, resolved from the header row. Matched most-specific first:
 * "Acc. location Code" contains both "location" and "code", and "Customer Code"
 * and "Customer Name" share a word, so a looser order would mis-assign them.
 */
function headerColumns(ws: ExcelJS.Worksheet, file: string): Record<keyof SheetRow, number> {
  const found: Partial<Record<keyof SheetRow, number>> = {};
  const header = ws.getRow(1);
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const h = norm(header.getCell(c).value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!h) continue;
    let key: keyof SheetRow | undefined;
    if (h.includes('acc') && h.includes('location')) key = 'accLocationCode';
    else if (h.includes('customer') && h.includes('code')) key = 'customerCode';
    else if (h.includes('customer') && h.includes('name')) key = 'customerName';
    else if (h.includes('location') && h.includes('name')) key = 'locationName';
    else if (h.includes('spoc')) key = 'spoc';
    else if (h.includes('approver') || h.includes('cluster')) key = 'manager';
    if (key && found[key] === undefined) found[key] = c;
  }
  const required: (keyof SheetRow)[] = [
    'customerCode',
    'accLocationCode',
    'customerName',
    'locationName',
    'spoc',
    'manager',
  ];
  const missing = required.filter((k) => found[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`${file}: header row is missing column(s): ${missing.join(', ')}`);
  }
  return found as Record<keyof SheetRow, number>;
}

async function readRows(file: string): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const col = headerColumns(ws, file);
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return; // header
    const r: SheetRow = {
      customerCode: norm(row.getCell(col.customerCode).value),
      accLocationCode: norm(row.getCell(col.accLocationCode).value),
      customerName: norm(row.getCell(col.customerName).value),
      locationName: norm(row.getCell(col.locationName).value),
      spoc: norm(row.getCell(col.spoc).value),
      manager: norm(row.getCell(col.manager).value),
    };
    // A row missing any of these can't produce a usable clinic, so skip loudly
    // rather than importing a half-clinic.
    if (!r.customerCode || !r.accLocationCode || !r.locationName || !r.spoc || !r.manager) {
      console.warn(`  ! ${file} row ${n} skipped — missing required column(s)`);
      return;
    }
    rows.push(r);
  });
  return rows;
}

/** Every source, concatenated — see the note on one-pass importing up top. */
async function readAllRows(files: string[]): Promise<SheetRow[]> {
  const all: SheetRow[] = [];
  for (const file of files) {
    const rows = await readRows(file);
    console.log(`  ${file} → ${rows.length} row(s)`);
    all.push(...rows);
  }
  return all;
}

/**
 * Clinic display name. The Location Name alone is normally enough, but it is NOT
 * unique in the source: "SSN Chennai" appears twice — same physical location, same
 * acc. location code, billed to two different customers. Where that happens the
 * customer name is appended so the two are tellable apart on the dashboard, in the
 * status tiles and in exports (all of which show the name alone).
 */
function clinicNames(rows: SheetRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.locationName, (seen.get(r.locationName) ?? 0) + 1);
  return rows.map((r) =>
    (seen.get(r.locationName) ?? 0) > 1 ? `${r.locationName} — ${r.customerName}` : r.locationName,
  );
}

async function main(): Promise<void> {
  const files = sourceFiles();
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Reading ${files.length} workbook(s)${dryRun ? '  (DRY RUN — nothing will be written)' : ''}`);

  const rows = await readAllRows(files);
  const names = clinicNames(rows);

  // ── People. A SPOC or manager covers MANY clinics, so collect their clinic sets
  //    first and create each person exactly once with all of them.
  const spocClinics = new Map<string, number[]>();
  const managerClinics = new Map<string, number[]>();
  rows.forEach((r, i) => {
    spocClinics.set(r.spoc, [...(spocClinics.get(r.spoc) ?? []), i]);
    managerClinics.set(r.manager, [...(managerClinics.get(r.manager) ?? []), i]);
  });

  // Email collisions would silently merge two real people into one account, so they
  // are a hard error rather than something to auto-suffix around.
  const byEmail = new Map<string, string>();
  for (const person of [...spocClinics.keys(), ...managerClinics.keys()]) {
    const email = `${emailSlug(person)}@cpp.local`;
    const clash = byEmail.get(email);
    if (clash && clash !== person) {
      throw new Error(`Email collision: "${person}" and "${clash}" both map to ${email}`);
    }
    byEmail.set(email, person);
  }

  console.log(
    `  parsed ${rows.length} clinics · ${spocClinics.size} SPOCs · ${managerClinics.size} cluster managers`,
  );
  if (dryRun) {
    for (const [person, idx] of spocClinics) {
      console.log(`    SPOC     ${emailSlug(person)}@cpp.local`.padEnd(48) + `${idx.length} clinic(s)  ${person}`);
    }
    for (const [person, idx] of managerClinics) {
      console.log(`    MANAGER  ${emailSlug(person)}@cpp.local`.padEnd(48) + `${idx.length} clinic(s)  ${person}`);
    }
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma: PrismaClient = app.get(PrismaService);
    const clinicsSvc = app.get(ClinicsService);
    const usersSvc = app.get(UsersService);
    const mappingsSvc = app.get(ClinicExpenseHeadsService);

    // ── Replace: demo clinics first (cascading their submissions/entries), which is
    //    what frees the demo users to be deleted.
    const removedClinics = await prisma.clinic.deleteMany({
      where: { name: { in: DEMO_CLINIC_NAMES } },
    });
    const removedUsers = await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { in: ['spoc@cpp.local', 'manager@cpp.local', 'clinic.viewer@cpp.local'] } },
          { email: { startsWith: 'spoc.' } },
          { email: { startsWith: 'manager.' } },
        ],
        // Never touch the finance accounts, whatever their address looks like.
        role: { in: [UserRole.CLINIC_SPOC, UserRole.CLINIC_MANAGER, UserRole.CLINIC_VIEWER] },
      },
    });
    // Re-running this seed replaces its OWN clinics too (matched by the real
    // acc-location + customer code pair), so it is idempotent.
    const removedPrevious = await prisma.clinic.deleteMany({
      where: {
        OR: rows.map((r) => ({
          accLocationCode: r.accLocationCode,
          customerCode: r.customerCode,
        })),
      },
    });
    const removedPeople = await prisma.user.deleteMany({ where: { email: { in: [...byEmail.keys()] } } });
    console.log(
      `  removed ${removedClinics.count} demo clinic(s), ${removedUsers.count} demo clinic user(s)` +
        `, ${removedPrevious.count} previously-imported clinic(s), ${removedPeople.count} previously-imported user(s)`,
    );

    // ── Clinics, via the audited service.
    const clinicIds: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const clinic = await clinicsSvc.create({
        name: names[i],
        accLocationCode: rows[i].accLocationCode,
        customerCode: rows[i].customerCode,
        customerName: rows[i].customerName,
      });
      clinicIds.push(clinic.id);
    }

    // ── Map every active expense head to every new clinic, so their cycles can
    //    open with a real provision form. Without this a clinic opens an EMPTY
    //    form and nothing can be entered against it.
    const heads = await prisma.expenseHead.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const clinicId of clinicIds) {
      await mappingsSvc.setMappings(clinicId, heads.map((h) => h.id));
    }

    // ── People, each created once with their full clinic set.
    for (const [person, idx] of spocClinics) {
      await usersSvc.create({
        name: person,
        email: `${emailSlug(person)}@cpp.local`,
        password: SPOC_PASSWORD,
        role: UserRole.CLINIC_SPOC,
        clinicIds: idx.map((i) => clinicIds[i]),
      });
    }
    for (const [person, idx] of managerClinics) {
      await usersSvc.create({
        name: person,
        email: `${emailSlug(person)}@cpp.local`,
        password: MANAGER_PASSWORD,
        role: UserRole.CLINIC_MANAGER,
        clinicIds: idx.map((i) => clinicIds[i]),
      });
    }

    report(rows, names, spocClinics, managerClinics, heads.length);
  } finally {
    await app.close();
  }
}

function report(
  rows: SheetRow[],
  names: string[],
  spocClinics: Map<string, number[]>,
  managerClinics: Map<string, number[]>,
  headCount: number,
): void {
  console.log(`\n✔ Imported ${rows.length} clinics, each mapped to ${headCount} expense head(s)`);
  const dupes = names.filter((n) => n.includes(' — '));
  if (dupes.length) {
    console.log(`  disambiguated by customer (duplicate location name in source): ${dupes.join(', ')}`);
  }
  console.log(`\n  CLINIC SPOCs (${spocClinics.size})  password: ${SPOC_PASSWORD}`);
  for (const [person, idx] of [...spocClinics].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${`${emailSlug(person)}@cpp.local`.padEnd(34)} ${String(idx.length).padStart(2)} clinic(s)   ${person}`);
  }
  console.log(`\n  CLUSTER MANAGERS (${managerClinics.size})  password: ${MANAGER_PASSWORD}`);
  for (const [person, idx] of [...managerClinics].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${`${emailSlug(person)}@cpp.local`.padEnd(34)} ${String(idx.length).padStart(2)} clinic(s)   ${person}`);
  }
  console.log('\n  Finance accounts are unchanged: admin@cpp.local / finance.manager@cpp.local');
  console.log('  No provision figures were invented — every clinic reads "No entry yet" (NULL ≠ 0).');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

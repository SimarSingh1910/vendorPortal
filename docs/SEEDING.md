# Seeding

Four seeds, in dependency order. The first three build the demo world; the fourth
is the one you run every month once that world exists.

| Script | Command (from `apps/api`) | Destructive? |
| --- | --- | --- |
| Admin | `pnpm prisma:seed:admin` | no — upserts the dev admin |
| Clinic demo | `pnpm prisma:seed:demo` | **YES** — see below |
| Corporate demo | `pnpm prisma:seed:corp` | yes, for corporate data only |
| **Real clinics** | `pnpm prisma:seed:real` | **YES** — replaces demo clinics + clinic users |
| **Month** | `pnpm prisma:seed:month` | no — one month, rebuilt in place |

---

## `prisma:seed:real` — the real clinic master data

`apps/api/prisma/seed-real-clinics.ts`, reading `apps/api/prisma/data/clinics.xlsx`.

Imports the organisation's actual clinics, SPOCs and cluster managers from the
spreadsheet, **replacing** the invented demo clinics.

```bash
cd apps/api
pnpm prisma:seed:real                            # reads prisma/data/clinics.xlsx
pnpm prisma:seed:real -- --file=../../Book2.xlsx # explicit path
pnpm prisma:seed:real -- --dry-run               # parse + report, write nothing
```

Stop the API dev server first — it runs `nest build`, which fails with `EPERM` on
Windows while `nest --watch` holds `dist/`.

Source columns (row 1 is the header): Customer Code · Acc. location Code · Customer
Name · Location Name · Clinic SPOC · Approver (Cluster Manager).

| Replaced | Left alone |
| --- | --- |
| The 6 demo clinics and all their submissions · the demo clinic logins (`spoc@`, `manager@`, `clinic.viewer@`, `spoc.<code>@`, `manager.<code>@`) · anything a previous run of THIS seed created (matched on acc-location + customer code, which is what makes it idempotent) | Finance accounts · the expense-head master · the whole corporate side · any clinic added by hand in the admin UI |

Clinics are deleted **before** users on purpose: `ProvisionEntry.enteredById` is
`Restrict`, so a user with surviving entries cannot be deleted. Cascading the
clinics clears the entries first.

**Masters only — no provision figures.** The spreadsheet carries no amounts, so
none are invented: every clinic reads "No entry yet", never a fabricated ₹0
(NULL ≠ 0). Written through `ClinicsService` / `UsersService` /
`ClinicExpenseHeadsService`, so every row is audit-logged as if a Finance Admin had
entered it.

**Logins** are derived from the real names as `first.last@cpp.local` (honorifics
dropped from the address, kept in the display name), with the standard dev
passwords — `Spoc@12345` for SPOCs, `Manager@12345` for cluster managers. An email
collision between two different people is a hard error, never auto-suffixed.

### Result of the import

43 clinics across 8 customers, each mapped to all 15 expense heads (645 mappings),
with full SPOC coverage — 0 clinics without one.

| Cluster manager | Clinics | | Clinic SPOC | Clinics |
| --- | --- | --- | --- | --- |
| `mukesh.pandey@` | 18 | | `chillara.kiranmayi@` | 8 |
| `kavitha.dhinesh@` | 13 | | `jibesh.mishra@` | 8 |
| `vivek.govindaraj@` | 10 | | `ragul.balaji@` | 7 |
| `hina.datt@` | 2 | | `reena.kumari@` | 6 |
| | | | `saranyadas.ks@` | 5 |
| | | | `kajamydeen.a@` | 3 |
| | | | `roshan.joshi@`, `anisha.joseph@` | 2 each |
| | | | `lincy.koshy@`, `arpit.gautam@` | 1 each |

**One source-data quirk, handled explicitly:** "SSN Chennai" appears twice — same
location, same acc-location code `L59`, billed to two different customers (`C21`
SSN Trust and `C74` SNU - Chennai). Both are kept as separate clinics, with the
customer name appended to the clinic name so they are tellable apart on the
dashboard, in the status tiles and in exports (all of which show the name alone).
That is the only place a name is disambiguated.

---

## `prisma:seed:month` — the monthly top-up

`apps/api/prisma/seed-month.ts`

Fills **one** cost-provision month with realistic data and leaves everything else
alone. This is what you want after a month rolls over and the scheduler has opened
a fresh set of empty cycles.

```bash
cd apps/api
pnpm prisma:seed:month                                  # the current IST month
pnpm prisma:seed:month -- --month=2026-08               # an explicit month
pnpm prisma:seed:month -- --month=2026-07 --all-approved # a settled HISTORY month
SEED_MONTH=2026-08 pnpm prisma:seed:month               # or via env
```

`--all-approved` drives every clinic to `FINANCE_APPROVED` instead of spreading them
across the status plan — what a past month wants, since the trend, clinic-total and
variance charts need complete settled figures behind them. To build a fresh set of
months, run the history first and the current month last. After the first
`nest build` you can skip the rebuild:

```bash
for m in 2026-05 2026-06 2026-07; do node dist/prisma/seed-month.js --month=$m --all-approved; done
node dist/prisma/seed-month.js --month=2026-08
```

It boots the Nest application context, so it runs `nest build` first. **Stop the
API dev server before running it** — a running `nest --watch` holds `dist/` open and
the build fails with `EPERM` on Windows.

### Why it exists separately from `prisma:seed:demo`

`seed-demo.ts` builds the entire demo world and is destructive: it deletes the demo
clinics and resets the whole `ExpenseHead` master. Once you have history worth
keeping — plus any clinic added by hand — you don't want that just to populate a new
month. `seed-month.ts` is the surgical alternative.

| Touched | Never touched |
| --- | --- |
| The target month's `MonthlySubmission` rows for eligible clinics — deleted and rebuilt (this is what makes a re-run idempotent). Snapshots, entries, particulars and comments cascade with them. | Every other month · all users · all clinics · the entire expense-head master · notification history (kept, with a null submission) |

### Everything goes through the real services

No status is ever written by hand:

```
CycleService.openClinicCycle
  → ProvisionEntryService.saveEntries          (as the clinic's own SPOC)
    → WorkflowService.submit                   (SPOC)
      → managerOpenReview / managerApprove | managerSendBack   (clinic manager)
        → financeOpenReview / financeApprove | financeSendBack (finance)
```

So the head snapshots, the **derived** line amounts, the approval stamps and the
audit trail are all produced by the same code the browser drives. A state the
workflow would refuse cannot be seeded — an unreachable target throws rather than
quietly producing a row whose status and stamps disagree.

### Where the numbers come from

Three sources, tried in order — most faithful first, and only the last invents
anything:

1. **This clinic's own most recent populated month** — real G/L heads, vendors,
   product codes and particular names, carried forward and drifted (a deterministic
   +1%…+5% on the rate; quantities stay whole).
2. **The same head at another clinic**, for a head this clinic has never
   provisioned (e.g. one newly mapped to it).
3. **`prisma/head-baselines.ts`** — a typical monthly figure per G/L account, with
   the real vendor and product code, scaled by a stable per-clinic factor
   (~0.75–1.30 derived from the clinic id) so no two clinics report identical
   numbers. This is the bootstrap path: it only fires for a clinic with no history
   anywhere, which is exactly the state right after `prisma:seed:real`.

One clinic gets a deliberate ×2.4 spike on Radiology Services (G/L 41104016) so the
variance chart has something to flag.

**NULL ≠ 0 is respected.** A clinic with no usable template, or with no active SPOC
and clinic manager, is left completely untouched at "No entry yet" — never
zero-filled. A clinic where some head had no line to model on stops at `DRAFT`
rather than being pushed through a submit it would fail (BR-03).

### Status plan

Applied in clinic-name order and cycled, so all nine workflow states appear. The
first two entries are load-bearing: the Finance Manager's board buckets **only**
`FINANCE_APPROVED` into "approved" and **only** `FINANCE_REVIEW` into "in review" —
everything else falls into "not provided". Leading with one of each is what stops
two of the three tiles rendering empty.

| # | Status | Meaning |
| --- | --- | --- |
| 1 | `FINANCE_APPROVED` | done, locked → "approved" |
| 2 | `FINANCE_REVIEW` | on the finance desk → "in review" |
| 3 | `CLINIC_APPROVED` | cleared by the cluster manager, awaiting finance |
| 4 | `CLINIC_MANAGER_REVIEW` | in the cluster manager's queue |
| 5 | `SUBMITTED` | sent by the SPOC, not yet opened |
| 6 | `SENT_BACK_BY_MANAGER` | bounced back by the cluster manager |
| 7 | `SENT_BACK_BY_FINANCE` | bounced back by finance |
| 8 | `DRAFT` | SPOC part-way through — walkable end-to-end in the browser |
| 9 | `NOT_STARTED` | cycle opened, nothing entered — "No entry yet", never ₹0 |

`NOT_STARTED` is seeded by opening the cycle and then leaving it strictly alone: no
entries, no transitions. That is the honest empty state, and it is why a
not-started clinic never shows a fabricated zero.

---

## Result of the 2026-08 run

```
✔ Seeded 2026-08 through the real workflow (cycle open → entry → submit → manager → finance)
    Bengaluru Whitefield Clinic        FINANCE_APPROVED       17 vendor line(s)
    Chennai OMR Clinic                 FINANCE_REVIEW         17 vendor line(s)
    Hyderabad Gachibowli Clinic        SENT_BACK_BY_MANAGER   17 vendor line(s)
    Mumbai BKC Clinic                  CLINIC_MANAGER_REVIEW  17 vendor line(s)
    Pune Tech Park Clinic              DRAFT                  18 vendor line(s)
  Finance board: approved = 1 · in review = 1 · not provided = 3
```

Verified afterwards:

- **Stamps match the status exactly** — Bengaluru carries `submittedAt`,
  `approvedByManagerAt`, `approvedByFinanceAt` and `lockedAt`; Chennai stops after
  the manager approval; Pune has none. Consistent with a real walk, not asserted.
- **Audit trail written by the transitions** — `CYCLE_OPEN` ×5, `PROVISION_SAVE` ×5,
  `SUBMISSION_SUBMIT` ×4 (Pune stayed `DRAFT`), `SUBMISSION_MANAGER_OPEN_REVIEW` ×4,
  `SUBMISSION_MANAGER_APPROVE` ×2, `SUBMISSION_MANAGER_SEND_BACK` ×1,
  `SUBMISSION_FINANCE_OPEN_REVIEW` ×2, `SUBMISSION_FINANCE_APPROVE` ×1.
- **Zero placeholder rows** — no `TEMP-`/`PENDING-` values, no null vendor or
  product code.
- **Amounts derive correctly** — e.g. `381.89 × 12 = 4,582.68`, computed server-side.
- **Untouched, as promised** — 2026-04…2026-07 unchanged, and the hand-made
  `clinic A` (inactive) still has no current cycle.

`clinic A` is skipped because it is **inactive**; inactive clinics never get a
current cycle. Reactivate it and it will be picked up on the next run, provided it
has an active SPOC and clinic manager assigned.

---

## Dev logins

The portal tab is load-bearing — a clinic account cannot sign in on the Corporate
tab and vice versa. `FINANCE_ADMIN` is the only role spanning both.

| Tab | Email | Password | Role |
| --- | --- | --- | --- |
| Either | `admin@cpp.local` | `Admin@12345` | Finance Admin |
| Clinic | `finance.manager@cpp.local` | `FinMgr@12345` | Finance Manager |
| Clinic | `spoc@cpp.local` | `Spoc@12345` | Clinic SPOC (Pune) |
| Clinic | `manager@cpp.local` | `Manager@12345` | Cluster Manager (Pune) |
| Clinic | `clinic.viewer@cpp.local` | `Clinic@12345` | Clinic Viewer (Pune) |
| Clinic | `spoc.<code>@cpp.local` | `Spoc@12345` | per-clinic SPOC (e.g. `spoc.mum@`) |
| Clinic | `manager.<code>@cpp.local` | `Manager@12345` | per-clinic manager |
| Corporate | `corp.spoc@cpp.local` | `Spoc@12345` | Department SPOC |
| Corporate | `corp.finance@cpp.local` | `FinMgr@12345` | Corporate Finance Manager |
| Corporate | `corp.viewer@cpp.local` | `Clinic@12345` | Department Viewer |

`/auth/login` is rate-limited to 5/min — reuse tokens in scripts rather than
polling.

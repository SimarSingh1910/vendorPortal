# Master data reference — G/L accounts & product codes

**Source of this document:** the running local instance (`http://localhost:3001/api`), read on
**2026-07-29** — expense heads via `GET /expense-heads?status=all` as Finance Admin, product codes from
the runtime `@portal/shared` build. It reflects the **live database**, not the seed source, so
admin-made changes are included.

> This is a point-in-time snapshot. G/L accounts are admin-editable at runtime, so re-read them from the
> app rather than trusting this file after any master-data change. Product codes only change with a
> deploy (see below).

---

## 1. G/L accounts (expense heads)

All 15 are **active**. Sorted by G/L account number, as the admin screen lists them.

| # | G/L Account No. | G/L Account Name | Multi-vendor |
|---:|---|---|---|
| 1 | 41002007 | Locum | **Yes** |
| 2 | 41003001 | Staff welfare expense | No |
| 3 | 41103001 | Telephone/Mobile expenses | No |
| 4 | 41104002 | Consumables common | No |
| 5 | 41104016 | Radiology Services | No |
| 6 | 41107001 | Rent - building for Dental | **Yes** |
| 7 | 41109004 | Laundry Expenses | No |
| 8 | 41112001 | Events and exhibitions - Domestic | **Yes** |
| 9 | 41115002 | House keeping and maintenance | No |
| 10 | 41115009 | Postage and courier charges | No |
| 11 | 41115013 | Refreshment for patients | No |
| 12 | 41117001 | Ambulance Services | No |
| 13 | 41117002 | Biomedical Waste Services | No |
| 14 | 41117004 | Other Outsourced Services | **Yes** |
| 15 | 41402005 | Credit Card Machine Hire Charges | No |

Account names are recorded **verbatim** from the finance sheet, including their original capitalisation
and spacing (e.g. `House keeping and maintenance`, `Rent - building for Dental`). They are not
normalised, and shouldn't be.

`glAccountNo` is a **code stored as a string** — never an integer, never reformatted. Leading zeros and
exact digits are preserved.

### Multi-vendor heads

A multi-vendor head lets a SPOC enter **several vendor lines** against the same G/L account in one
month — each with its own vendor, product code, note and particulars. The head's Amount is the sum of
all its vendor lines.

**Currently four heads are flagged:**

| G/L Account No. | G/L Account Name | Origin |
|---|---|---|
| 41002007 | Locum | seeded |
| 41112001 | Events and exhibitions - Domestic | seeded |
| 41117004 | Other Outsourced Services | seeded |
| 41107001 | Rent - building for Dental | **enabled via the admin UI on 2026-07-29** |

> ⚠️ **Note the count.** The application was seeded with **three** multi-vendor heads (the first three
> above). `Rent - building for Dental` was switched on afterwards through Expense Heads → Edit, recorded
> in the audit trail as an `EXPENSE_HEAD_UPDATE` at 04:04 on 2026-07-29 which propagated to 4 open
> submissions. If that was a test rather than an intended change, untick it in the admin screen and this
> table returns to three.

Any head can be made multi-vendor: **Expense Heads → Edit → "Allow multiple vendor lines"** (Finance
Admin only). The change applies **immediately** to every month still open; approved/locked months keep
the setting they were approved under, and switching it back off leaves any month that already has
multiple vendor rows untouched so nothing entered is stranded.

---

## 2. Product codes

Six codes. The **stored value is the bare code** (e.g. `P27`); the dropdown shows the full label.

| Code | Description | Dropdown label |
|---|---|---|
| P27 | NCV / VAS | `P27 - NCV / VAS` |
| P21 | Dental Rental | `P21 - Dental Rental` |
| P20 | CC / OHC | `P20 - CC / OHC` |
| P18 | EHC / PHC | `P18 - EHC / PHC` |
| P17 | Health Check | `P17 - Health Check` |
| P10 | Care Plan | `P10 - Care Plan` |

Listed in the order they appear in the dropdown (descending by number, matching the finance sheet).

**Case matters.** Codes are uppercase `P##`. The retired lowercase demo values (`p10`, `p17`, `p18`,
`p20`) are rejected by validation.

**`PC` is deliberately excluded.** Row 1 of the finance sheet reads just "PC" with no product number
under the "Product Code" header — that's a header/label artefact, not a real code.

**Product code is mandatory.** Every vendor line needs one to submit. It may be left blank while
drafting (stored as `null`, never coerced), but submit is rejected with a message naming the line —
e.g. `"Locum" line 2 needs a product code`.

---

## 3. Where each lives — they are stored differently

| | G/L accounts | Product codes |
|---|---|---|
| Stored in | `ExpenseHead` table (MySQL) | `packages/shared/src/product-codes.ts` (code constant) |
| Editable by | Finance Admin, at runtime, in the UI | developers only — needs a deploy |
| Per-submission | **Snapshotted** at cycle-open | Not snapshotted — only the bare code is stored on the line |
| External sync | None — no SAP/ERP integration | None |

**Why the snapshot matters.** When a month's cycle opens, each mapped head's number, name and
multi-vendor flag are frozen onto that submission (`SubmissionExpenseHeadSnapshot`). Renaming a head
later does **not** rewrite history — an approved month keeps showing, and exporting, the name it was
actually provisioned under.

**Product codes have no such protection.** Only the code (`P27`) is stored per line; its description is
resolved from the constant at render time. If the *meaning* of a code ever changes, historical months
would display the new meaning. A code removed from the list still renders as its bare code rather than
blank, but the description is not frozen the way G/L names are.

That asymmetry was fine when the codes were four throwaway dummies. Now that they're the real finance
list, promoting them to an admin-managed master table (with snapshotting) is worth considering.

---

## How to regenerate this file

```bash
# Expense heads — live, as Finance Admin
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@cpp.local","password":"Admin@12345"}'   # take accessToken

curl -s 'http://localhost:3001/api/expense-heads?status=all' \
  -H "Authorization: Bearer <accessToken>"

# Product codes — from the built shared package
node -e "const s=require('./packages/shared/dist/index.js');
  for (const c of s.PRODUCT_CODES) console.log(s.productCodeLabel(c));"
```

Note the login route is rate-limited to 5 requests/minute — reuse the token rather than re-logging in.

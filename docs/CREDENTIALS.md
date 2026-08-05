# Dev logins — every role and its credentials

**DEV / DEMO ONLY.** These are seeded passwords for local and demo environments.
Never reuse them anywhere real, and never point a production database at the seeds
that create them.

Generated from the database on **2026-08-04**, after the real clinic import
(`pnpm prisma:seed:real`). 19 accounts, all active.

## The portal tab is load-bearing

Sign-in sends the active tab with the credentials, and the account must belong to
that portal — a clinic account **cannot** sign in on the Corporate tab and vice
versa. Getting this wrong returns "This account is not set up for the … portal",
not a password error. `FINANCE_ADMIN` is the only role spanning both tabs.

`/auth/login` is rate-limited to **5 requests/minute**. In scripts, log in once and
reuse the token rather than polling.

---

## Finance (Clinic portal)

| Role | Email | Password | Tab | Scope |
| --- | --- | --- | --- | --- |
| Finance Admin | `admin@cpp.local` | `Admin@12345` | **Either** | All 43 clinics + all departments |
| Finance Manager | `finance.manager@cpp.local` | `FinMgr@12345` | Clinic | All 43 clinics |

Finance roles hold **no** clinic assignment rows — org-wide access is implied by the
role, and the API rejects an attempt to assign them to a clinic.

## Cluster Managers (Clinic portal) — password `Manager@12345`

| Name | Email | Clinics |
| --- | --- | --- |
| Mukesh Kumar Pandey | `mukesh.pandey@cpp.local` | 18 |
| Kavitha Dhinesh | `kavitha.dhinesh@cpp.local` | 13 |
| Vivek Govindaraj | `vivek.govindaraj@cpp.local` | 10 |
| Hina Datt | `hina.datt@cpp.local` | 2 |

## Clinic SPOCs (Clinic portal) — password `Spoc@12345`

| Name | Email | Clinics |
| --- | --- | --- |
| Dr.Chillara Anjana Sesha Kiranmayi | `chillara.kiranmayi@cpp.local` | 8 |
| Jibesh Kumar Mishra | `jibesh.mishra@cpp.local` | 8 |
| Dr Ragul Balaji | `ragul.balaji@cpp.local` | 7 |
| Reena Kumari | `reena.kumari@cpp.local` | 6 |
| Saranyadas_KS | `saranyadas.ks@cpp.local` | 5 |
| Kajamydeen A | `kajamydeen.a@cpp.local` | 3 |
| Anisha Marium Joseph | `anisha.joseph@cpp.local` | 2 |
| Roshan Chandra Joshi | `roshan.joshi@cpp.local` | 2 |
| Arpit Gautam | `arpit.gautam@cpp.local` | 1 |
| Lincy Koshy | `lincy.koshy@cpp.local` | 1 |

Cluster-manager clinic counts sum to 43, and SPOC counts sum to 43 — every clinic
has exactly one of each, with no clinic left uncovered.

## Corporate portal

| Role | Email | Password | Scope |
| --- | --- | --- | --- |
| Corporate Finance Manager | `corp.finance@cpp.local` | `FinMgr@12345` | All departments |
| Department SPOC | `corp.spoc@cpp.local` | `Spoc@12345` | 3 departments (IT, HR, Shared Services) |
| Department Viewer | `corp.viewer@cpp.local` | `Clinic@12345` | 1 department (IT) |

---

## Roles with no account right now

| Role | Note |
| --- | --- |
| `CLINIC_VIEWER` | The old `clinic.viewer@cpp.local` belonged to the demo clinics and was removed by `prisma:seed:real`. The source spreadsheet lists only SPOCs and cluster managers, so no viewer was created. Add one via **Users** in the admin UI (Finance Admin only) if you need to exercise that role. |

## Where these come from

| Accounts | Created by |
| --- | --- |
| `admin@cpp.local` | `pnpm prisma:seed:admin` (upserted, never deleted) |
| `finance.manager@cpp.local` | `pnpm prisma:seed:demo` |
| All 14 clinic SPOCs and cluster managers | `pnpm prisma:seed:real`, from `prisma/data/clinics.xlsx` |
| The three `corp.*` accounts | `pnpm prisma:seed:corp` |

Clinic-role addresses are derived from the real names as `first.last@cpp.local`
(honorifics dropped from the address, preserved in the display name). See
[SEEDING.md](SEEDING.md) for what each seed does and which are destructive.

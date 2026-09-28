# Data Model Notes

These notes explain *why* a few tables exist the way they do. They are the
rationale behind the Prisma schema at `apps/api/prisma/schema.prisma`. Read this
before changing how a submission's entry form is built.

## Snapshots: why the form is driven by frozen heads, not live masters

A submission's entry form is driven by **`SubmissionExpenseHeadSnapshot`** rows —
the set of expense heads frozen onto that submission when its monthly cycle was
opened for the clinic. The form is **never** computed from the live
`ClinicExpenseHead` mapping or the live `ExpenseHead` master at render time.

When a clinic/month cycle opens, the job copies the clinic's then-active mapped
heads into snapshot rows, capturing each head's identity **and** its display
fields at that instant:

- `expenseHeadId` — link back to the master row (for reporting/aggregation).
- `expenseHeadNameAtSnapshot` — the head's name *as it was* when the cycle opened.
- `expenseHeadCategoryAtSnapshot` — the head's category *as it was* then.

From that point on, the SPOC enters one `ProvisionEntry` per snapshot row, and the
UI lists exactly the snapshotted heads using the `*AtSnapshot` labels.

### What this guarantees

- **BR-05 — master changes take effect next cycle only.** Adding, renaming,
  recategorizing, or deactivating an expense head (or changing a
  `ClinicExpenseHead` mapping) changes only what gets snapshotted into *future*
  cycles. Submissions that are already open or already closed keep the exact set
  of heads — and the exact names/categories — they were opened with, once anything
  has been entered into them. The single exception is below.

- **BR-02 — deactivation never alters history.** Deactivating a head sets
  `ExpenseHead.isActive = false`; it does **not** delete the row and does **not**
  touch existing snapshots. Past and in-flight submissions still show the head and
  its entered amount, because they read from their own snapshot, not from the
  (now inactive) master. History is immutable by construction.

  There is no delete endpoint for an expense head, so this holds unconditionally.
  The two rows that *can* be deleted — a clinic and a user, via `DELETE /clinics/:id`
  and `DELETE /users/:id` — are hard-deleted only when they carry **no** history:
  the service counts every reference first (submissions for a clinic; provision
  entries, comments, attachments, reviews and audit rows for a user) and refuses with
  409 if any exist. So deletion never reaches history either; it only ever removes a
  row nothing has recorded against. See `docs/IMPLEMENTATION_CONTEXT.md` for the full
  blocker list.

An open submission therefore keeps its snapshot even if a head is deactivated the
day after the cycle opened. The deactivation is only visible from the *next*
cycle, which simply won't snapshot that head.

### The exception: a cycle nothing has been entered into

A cycle in `NOT_STARTED`, or `DRAFT` with no `ProvisionEntry` rows, has no figures
to protect. Freezing it only strands the SPOC with a stale form — in production,
a month opened before any heads were mapped showed an empty form for the whole
month. So `CycleService.resyncUntouched` (run when the form is loaded) re-syncs
such a cycle's snapshot rows to the clinic's current mapping: newly mapped heads
are added, unmapped ones dropped, changed names / G/L numbers / multi-vendor flags
refreshed; unchanged heads keep their snapshot id. It holds a row lock on the
`MonthlySubmission` shared with `ProvisionEntryService.saveEntries`, so the first
save and a resync never interleave. From the first entry on, the snapshot is
frozen exactly as described above.

## How the schema encodes this

- `SubmissionExpenseHeadSnapshot` belongs to one `MonthlySubmission`
  (`@@unique([submissionId, expenseHeadId])` — a head appears at most once per
  submission).
- `ProvisionEntry.snapshotId` is a **foreign key to the snapshot row**, not to the
  live `ExpenseHead`. This is the structural enforcement: an entry can only exist
  against a head that was snapshotted onto the submission. It is also `@unique`
  (and `@@unique([submissionId, snapshotId])`), so each snapshot head holds at most
  one entry — exactly one amount per (submission, head).
- The snapshot stores `*AtSnapshot` display fields so renaming a master head later
  cannot retroactively relabel a closed month.

If you ever find code building the form from `ClinicExpenseHead` or `ExpenseHead`
for a given submission, that is a bug: it reintroduces the manual-process problem
this design exists to prevent. (The resync above does not build the form from the
masters; it rewrites the snapshot rows of an untouched cycle, and the form still
reads only the snapshot.)

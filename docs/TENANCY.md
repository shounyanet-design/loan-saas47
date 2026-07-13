# Point.47 — Multi-Tenancy (Foundation) Documentation

Status: Milestone 1 + 1.1 (foundation + hardening). Single default tenant in
production today; architecture is multi-tenant ready.

## 1. Architecture

```
HTTP request
  → protect / protectVerification (resolve user in SYSTEM mode, read tenantId from DB)
    → tenantContext.runWithTenant(tenantId, () => next())
      → controllers/services run inside the tenant context
        → tenantPlugin auto-scopes every Mongoose operation by tenantId
```

- **`src/tenancy/tenantContext.js`** — AsyncLocalStorage holding `{ tenantId, system }`.
  - `runWithTenant(tenantId, fn)` — tenant mode (auto-filter + auto-stamp).
  - `runAsSystem(fn)` — bypass mode for trusted cross-tenant work (auth bootstrap, migrations, platform cron).
  - Callbacks are awaited *inside* the context so deferred Mongoose queries execute while the context is active.
- **`src/tenancy/tenantPlugin.js`** — applied to all 34 tenant-scoped models. Adds `tenantId`, auto-filters reads/updates/deletes, auto-stamps writes, `$match`-injects aggregations. **Fail-closed**.

## 2. Tenant resolution & JWT
- JWT payload: `{ id, role, tenantId }`. `tenantId` is included when known.
- Tenant is **always** resolved from the user's DB record in auth middleware — never trusted from the request body/query/header.
- Legacy tokens (no `tenantId`) still authenticate; tenant is resolved from the DB.

## 3. Operation coverage (penetration-tested)

| Operation | Behavior in tenant mode | SYSTEM mode |
|---|---|---|
| find / findOne / findById | auto-filtered by tenantId | unfiltered |
| findOneAndUpdate/Delete/Replace | auto-filtered | unfiltered |
| update / updateOne / updateMany | auto-filtered | unfiltered |
| replaceOne | auto-filtered | unfiltered |
| deleteOne / deleteMany | auto-filtered | unfiltered |
| countDocuments | auto-filtered | unfiltered |
| distinct | **auto-filtered** (added in 1.1) | unfiltered |
| aggregate | `$match { tenantId }` prepended (root only — see note) | unfiltered |
| save / create | auto-stamped; cross-tenant save throws | respects explicit tenantId |
| insertMany | auto-stamped per doc | respects explicit tenantId |
| populate | ref query runs in-context → cross-tenant ref resolves to `null` | unfiltered |
| bulkWrite | **fail-closed: throws** (not auto-scopable) | allowed (set tenantId explicitly) |
| estimatedDocumentCount | **fail-closed: throws** (use countDocuments) | allowed |
| no context (neither mode) | **throws** (fail-closed) | n/a |

**`$lookup` caveat:** the aggregate guard scopes the root collection only. Any
future aggregation using `$lookup` must add a `tenantId` match inside the lookup
sub-pipeline. There is no `$lookup` usage today.

## 4. Indexes

### Tenant-scoped unique indexes (replaced global uniques in migration 003)
| Model | Compound unique | Partial? |
|---|---|---|
| User | `{tenantId, email}` | — (plus standalone `email` index for global login lookup) |
| Borrower | `{tenantId, email}`, `{tenantId, idNumber}`, `{tenantId, borrowerCode}` | idNumber/borrowerCode partial (string-only) |
| Staff | `{tenantId, email}`, `{tenantId, phoneNumber}`, `{tenantId, idNumber}`, `{tenantId, employeeId}` | employeeId partial |
| Agent | `{tenantId, email}`, `{tenantId, phoneNumber}`, `{tenantId, idNumber}`, `{tenantId, employeeId}` | employeeId partial |
| LoanApplication | `{tenantId, applicationId}` | — |
| ActiveLoan | `{tenantId, loanCode}` | — |
| Payment | `{tenantId, transactionId}` | — |
| Notification | `{tenantId, notificationId}` | partial |
| Commission | `{tenantId, commissionCode}` | partial |

**Stayed global (intentionally):** `Borrower.userId` (globally-unique ObjectId),
`DuePayment {loanId, installmentNumber}` and `RepaymentSchedule {loanId, emiNumber}`
(keyed on globally-unique `loanId` ObjectId — no cross-tenant collision possible).

### Performance indexes (tenant-prefixed)
- `tenantId` single-field index on every scoped model (via plugin).
- `RepaymentSchedule {tenantId, status, dueDate}` (daily EMI cron), `{tenantId, borrowerId}`.
- `DuePayment {tenantId, dueStatus, isDeleted}` (overdue reporting/collections).
- `LoanActivity {tenantId, loanId, createdAt}`, `{tenantId, borrowerId, createdAt}`.
- `VerificationLog {tenantId, borrowerId, verificationType, createdAt}`.
- `Notification {tenantId, receiverId, status}`, `{tenantId, createdAt}`.

## 5. Migrations

Run: `npm run migrate` (up) — `node src/migrations/run.js down` (rollback).

| # | Purpose | Idempotent | Rollback |
|---|---|---|---|
| 001 | Create default tenant + settings | yes (findOne/upsert) | `down()` removes tenant + settings |
| 002 | Backfill `tenantId` on all docs | yes (`$exists:false`/null only) | `down()` (guarded by `MIGRATION_ALLOW_DOWN=true`) unsets tenantId |
| 003 | Convert global→tenant unique indexes + build perf indexes (`syncIndexes`) | yes (reconciles to schema) | `down()` drops new compound uniques (does NOT restore global uniques — unsafe in multi-tenant) |

- All run in SYSTEM mode. Native-driver updates bypass the plugin.
- **Order matters:** 001 → 002 → 003. Run 002 before 003 so every doc has a tenantId before unique indexes build.
- Index builds: within a single tenant, previously-global-unique values remain unique, so unique builds succeed without conflict.

## 6. Security model
- **Fail-closed isolation:** any tenant-scoped op with no context throws; never returns unscoped data.
- **Scope lock:** the plugin forces the context tenantId onto query filters; a caller-supplied `tenantId` cannot widen scope. Saving into another tenant throws.
- **Un-scopable ops** (`bulkWrite`, `estimatedDocumentCount`) fail closed outside SYSTEM mode.
- **Tenant authority:** resolved from DB, never from the client.
- **Shared integrations** (Datanamix, FaceTec, BulkSMS, ImageKit, Email, NuPay/Webfin) remain global/unchanged. `TenantApiSettings` exists but is inert (per-tenant NuPay is a later milestone).

## 7. SYSTEM-mode usage inventory (audited)
- `protect` / `protectVerification` — user lookup during auth bootstrap.
- `authController.login` — user lookup by email; `register` resolves default tenant (then creates in tenant context).
- `cronService` — resolves default tenant, runs the daily EMI job in that tenant's context (single-tenant scope for now).
- migrations — all run in SYSTEM mode.
No other SYSTEM-mode usage exists.

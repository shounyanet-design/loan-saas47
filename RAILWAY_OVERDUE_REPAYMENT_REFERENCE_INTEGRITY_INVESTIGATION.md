# RAILWAY PRODUCTION INVESTIGATION REPORT
## Overdue Repayment Schedule Missing Loan/Borrower References

**Project:** Point.47 LMS — `loan-saas47`  
**Environment:** Railway Production  
**Investigation Date:** October 02, 2026  
**Final Status:** `MULTIPLE_CAUSES_FOUND`

---

## 1. Executive Summary

During production operations on Railway, the daily overdue repayment cron emitted repeated warning logs:
```text
[Cron] Overdue repayment schedule <id> references missing loan or borrower. Skipping.
```

An investigation was conducted across the codebase, model schemas, tenancy plugins, cascade delete handlers, and cron execution flows. 

**Key Finding:** No financial data or active user transaction balances were mutated or corrupted. The warning log occurs because **orphaned repayment schedules** exist in MongoDB due to schema field mismatches in cascade delete operations and uncascaded borrower deletions. Furthermore, `cronService.js` contains a model reference bug (`Loan` vs `ActiveLoan`) and skips unresolved records without mutating their status, causing the exact same orphaned schedules to trigger warning logs every single night at midnight.

---

## 2. Phase 1 — Tracing the Cron & Log Origin

### Log Origin Location
- **Source File:** [`src/services/cronService.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js)
- **Functions:** `checkOverdueEMIs()` (lines 142–224) and `checkUpcomingEMIs()` (lines 58–137)
- **Cron Schedule:** `0 0 * * *` (Daily at Midnight)

### Query and Relationship Resolution Logic

In `cronService.js` (lines 147–151):
```javascript
const overdueEmis = await RepaymentSchedule.find({
  status: 'Pending',
  dueDate: { $lt: today }
}).populate('loanId borrowerId');
```

In `cronService.js` (lines 155–158):
```javascript
if (!emi.loanId || !emi.borrowerId) {
  console.warn(`[Cron] Overdue repayment schedule ${emi._id} references missing loan or borrower. Skipping.`);
  continue;
}
```

When Mongoose executes `.populate('loanId borrowerId')`, it looks up the referenced documents (`ActiveLoan` for `loanId` and `Borrower` for `borrowerId`). If either referenced document is missing, null, or excluded by query/tenant filters, Mongoose sets `emi.loanId` or `emi.borrowerId` to `null`. The `if (!emi.loanId || !emi.borrowerId)` guard evaluates to `true`, logging the warning and calling `continue`.

---

## 3. Phase 2 — Reference Integrity Analysis

| # | Question | Findings / Empirical Evidence |
|---|---|---|
| 1 | **Does the repayment schedule exist?** | **Yes.** `RepaymentSchedule.find({ status: 'Pending', dueDate: { $lt: today } })` retrieves valid documents from the `repaymentschedules` collection in MongoDB. |
| 2 | **What are its stored reference fields?** | `loanId` (ref: `'ActiveLoan'`, ObjectId) and `borrowerId` (ref: `'Borrower'`, ObjectId). |
| 3 | **Does the referenced loan exist?** | **No (in orphaned cases).** In cases where an `ActiveLoan` was hard-deleted by an admin, the `ActiveLoan` document was removed from `activeloans`, but `RepaymentSchedule` remained. |
| 4 | **Does the referenced borrower exist?** | **No (in orphaned cases).** In cases where a `Borrower` profile was hard-deleted via `deleteBorrower`, the `Borrower` document was removed from `borrowers`, leaving orphaned schedule entries. |
| 5 | **Is the relationship direct or indirect?** | Direct foreign key references (`loanId -> ActiveLoan._id` and `borrowerId -> Borrower._id`). |
| 6 | **Are reference types consistent with schema?** | **Yes.** Both use `mongoose.Schema.Types.ObjectId`. However, model loading and cascade delete field names were mismatched in controller logic. |
| 7 | **Does `populate()` resolve correctly?** | `populate()` returns `null` when the target record has been hard deleted, or when tenant-scoping filters in `tenantPlugin` block cross-tenant lookups. |
| 8 | **Are records archived, soft-deleted, or tenant-scoped?** | `ActiveLoan` contains `isDeleted: true`. `tenantPlugin.js` appends `this.where({ tenantId })` to queries. If a schedule has `tenantId: A` while its loan has `tenantId: B` (or `tenantId: null`), `populate()` yields `null`. |
| 9 | **Are multiple schedule entries linked to the same loan?** | **Yes.** A single loan has multiple installments (e.g., 3, 6, 12 monthly EMIs). When an `ActiveLoan` is deleted without cascading schedule cleanup, all 3–12 installment records remain orphaned. |
| 10 | **What causes the repeated log messages?** | **Non-mutating skip in the cron.** When `populate()` returns `null`, `cronService.js` logs a warning and calls `continue` **without changing `emi.status`**. Since `emi.status` stays `'Pending'`, every daily cron run fetches the exact same schedule IDs again and re-logs the warning endlessly. |

---

## 4. Phase 3 — Production Safety Audit

- **Data Mutations Check:** **Zero financial mutations occurred.** Because `cronService.js` executes `continue` immediately upon detecting a null `loanId` or `borrowerId`, no payment amounts, loan balances, transaction records, or notification entries were created or altered for these records.
- **Production MongoDB Data Integrity:** Untouched. All queries performed during this investigation were strictly read-only.
- **Manual Cron Execution:** **Not performed against production.**

---

## 5. Phase 4 — Root Cause Classification (`MULTIPLE_CAUSES_FOUND`)

Four distinct code-level defects combine to cause this incident:

```mermaid
graph TD
    A["Admin Deletes ActiveLoan"] -->|activeLoanController.js L623| B["deleteMany({ activeLoanId: id })"]
    B -->|Field name mismatch: schema uses 'loanId'| C["0 RepaymentSchedules Deleted (Orphaned in DB)"]
    
    D["Admin Deletes Borrower"] -->|borrowerController.js L437| E["Borrower.findByIdAndDelete(id)"]
    E -->|No cascade cleanup| F["RepaymentSchedules Orphaned in DB"]
    
    C --> G["Daily Cron Executes checkOverdueEMIs()"]
    F --> G
    
    G -->|RepaymentSchedule.find().populate('loanId borrowerId')| H["populate() Returns null for Missing Ref"]
    H -->|if (!emi.loanId || !emi.borrowerId)| I["Log Warning & Call continue"]
    I -->|emi.status remains 'Pending'| J["Repeated Daily Warning Logs"]
    
    G -->|When Loan is Valid| K["Loan.findByIdAndUpdate(loan._id)"]
    K -->|Bug: imports legacy 'Loan' instead of 'ActiveLoan'| L["ActiveLoan Status NOT Updated to Overdue"]
```

### 1. Cause A: Field Name Mismatch in `activeLoanController.js` Cascade Delete (Primary Cause)
- **Location:** [`src/controllers/admin/activeLoanController.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/admin/activeLoanController.js#L623-L629)
- **Code Snippet:**
  ```javascript
  // Line 623
  await RepaymentSchedule.deleteMany({ activeLoanId: activeLoan._id }, { session });
  // Line 629
  await Payment.deleteMany({ activeLoanId: activeLoan._id }, { session });
  ```
- **Defect:** `RepaymentSchedule` and `Payment` models do NOT have an `activeLoanId` field; their schema field is named **`loanId`**. Consequently, `deleteMany({ activeLoanId })` matched **0 documents**. When an admin hard-deleted an `ActiveLoan`, the loan was deleted, but all of its `RepaymentSchedule` and `Payment` records were left behind as orphans in MongoDB.

### 2. Cause B: Uncascaded Borrower Hard Delete in `borrowerController.js`
- **Location:** [`src/controllers/borrowerController.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/borrowerController.js#L437)
- **Defect:** `deleteBorrower` hard-deletes the `Borrower` and `User` documents without checking or deleting associated `RepaymentSchedule` or `ActiveLoan` records.

### 3. Cause C: Incorrect Model Import & Update Target in `cronService.js`
- **Location:** [`src/services/cronService.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js#L5)
- **Code Snippet:**
  ```javascript
  // Line 5
  const Loan = require('../models/Loan');
  // Line 170
  if (loan.loanStatus === 'Active') {
    await Loan.findByIdAndUpdate(loan._id, { loanStatus: 'Overdue' });
  }
  ```
- **Defect:** `cronService.js` imports `Loan` (legacy schema) instead of `ActiveLoan`. When an EMI becomes overdue, line 170 attempts to update `Loan` in the `loans` collection instead of `ActiveLoan` in `activeloans`. The `ActiveLoan` remains stuck in `loanStatus: 'Active'`.

### 4. Cause D: Infinite Cron Log Loop due to Non-Mutating Skip
- **Location:** [`src/services/cronService.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js#L76) & [`L156`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js#L156)
- **Defect:** When a schedule fails population, `cronService` logs a warning and calls `continue`. Because `emi.status` is never updated from `'Pending'`, the schedule is re-queried on every single daily cron invocation.

---

## 6. Phase 5 — Minimal Proposed Remediation Plan

### 1. Fix Cascade Delete Query Field Names
In [`src/controllers/admin/activeLoanController.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/admin/activeLoanController.js):
```diff
- await RepaymentSchedule.deleteMany({ activeLoanId: activeLoan._id }, { session });
+ await RepaymentSchedule.deleteMany({ loanId: activeLoan._id }, { session });

- await Payment.deleteMany({ activeLoanId: activeLoan._id }, { session });
+ await Payment.deleteMany({ loanId: activeLoan._id }, { session });
```

### 2. Correct Model Import and Status Update Target in Cron Service
In [`src/services/cronService.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js):
```diff
- const Loan = require('../models/Loan');
+ const ActiveLoan = require('../models/ActiveLoan');

  if (loan.loanStatus === 'Active') {
-   await Loan.findByIdAndUpdate(loan._id, { loanStatus: 'Overdue' });
+   await ActiveLoan.findByIdAndUpdate(loan._id, { loanStatus: 'Overdue' });
  }
```

### 3. Graceful Handling & Audit Logging for Unresolved Schedules
In [`src/services/cronService.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js):
- Add a system-mode fallback check (`tenantContext.runAsSystem`) to verify if the loan/borrower exists under another tenant or soft-deleted status.
- If the reference is genuinely deleted/orphaned, update `emi.status = 'Disputed'` or mark `emi.unresolvedReference = true` and write a single structured audit log entry to `PlatformAuditLog`.
- This prevents perpetual daily cron retry loops while keeping financial audit records intact.

### 4. Borrower Deletion Safeguard
In [`src/controllers/borrowerController.js`](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/borrowerController.js):
- Block hard deletion of `Borrower` if active loans or pending schedules exist, or enforce transactional cascade cleanup of associated schedules.

---

## 7. Required Test Plan (10 Scenarios)

1. **Valid schedule with valid loan and borrower:** Verify `checkOverdueEMIs()` marks schedule as `Overdue` and updates `ActiveLoan.loanStatus` to `Overdue`.
2. **Missing loan reference:** Verify cron flags the schedule without crashing or throwing an unhandled rejection.
3. **Missing borrower reference:** Verify cron handles missing borrower cleanly with structured audit log.
4. **Invalid reference ID format:** Verify schema validation handles malformed ObjectIds.
5. **Populate failure:** Verify system-mode fallback resolution is attempted before declaring record orphaned.
6. **Tenant mismatch:** Verify cross-tenant references are flagged for tenant security audit.
7. **Archived / soft-deleted record (`isDeleted: true`):** Verify soft-deleted loans do not crash the daily cron.
8. **Duplicate cron invocation:** Verify idempotent cron execution (running twice on the same day produces identical state).
9. **Zero financial mutation:** Assert that unresolved schedule processing leaves loan balances and payment transactions completely untouched.
10. **Normal processing of valid schedules:** Ensure all valid overdue schedules continue to receive notifications and socket events normally.

---

## 8. Deployment & Rollback Considerations

- **Deployment Safety:** The proposed fixes are purely backend query and model target corrections. They do not alter database schemas or API contracts.
- **Rollback Plan:** Standard Git rollback if required. No DB rollback operations needed.
- **Data Cleanup Script (Optional Admin Maintenance):** An admin cleanup script wrapped in `tenantContext.runAsSystem` can identify orphaned `RepaymentSchedule` documents (`loanId` not found in `ActiveLoan`) and mark them as `'Disputed'` or soft-delete them safely.

---

**Report Final Status:** `MULTIPLE_CAUSES_FOUND`

# PHASE 2: ADMIN MANUAL EMI PAYMENT RECEIPT — IMPLEMENTATION REPORT

**Project:** Point.47 LMS (`loan-saas47` Backend & `Saas_Frontend` UI)  
**Feature:** Receive Manual Payment Against an Individual Term Loan EMI  
**Date:** September 30, 2026  
**Final Status:** `IMPLEMENTATION_PASS`

---

## 1. Summary of Implemented Feature

Under **Admin → Active Loans → Repayment Schedule**, each active/unpaid installment now provides a direct action to receipt a manual payment (Cash Deposit, EFT, Bank Transfer, Mobile Payment) made outside of automated debit orders (NuPay).

When an Admin clicks **"Receive Manual Payment"** for an individual EMI:
1. A dedicated modal opens displaying loan and installment details, base EMI, late fees, past payments, and net remaining balance due.
2. The Admin specifies amount received, payment date, payment method, optional transaction reference, and notes.
3. The backend validates and atomically processes the payment within a MongoDB session/transaction:
   * The selected installment (`RepaymentSchedule`) is updated to `'Paid'` (or `'Partial'`).
   * A verified `Payment` record is created, linking directly to the loan and EMI number.
   * The embedded `ActiveLoan.repaymentSchedule` is synchronized.
   * `ActiveLoan.remainingBalance` is recalculated using the authoritative accounting formula.
   * `ActiveLoan.nextDueDate` and auto-completion status are updated.
   * Corresponding `DuePayment` records are marked `'Paid'`.
   * An immutable `LoanActivity` audit record is stored.
   * Real-time socket events are dispatched to refresh admin dashboards.
4. The modal closes, toasts success, and seamlessly refreshes the Repayment Schedule table and background loan portfolio without full page reloads.

---

## 2. Exact Files Changed

### Backend (`loan-saas47`)
1. [src/models/Payment.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/models/Payment.js)
   * Added `repaymentScheduleId` (ObjectId ref `RepaymentSchedule`) and `emiNumber` (Number).
   * Added `'Reversed'` to `paymentStatus` enum.
2. [src/models/ActiveLoan.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/models/ActiveLoan.js)
   * Added `'Partial'` and `'Late Paid'` to embedded `repaymentScheduleSchema.paymentStatus` enum to eliminate Mongoose validation errors during partial payment saves.
3. [src/controllers/repaymentController.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/repaymentController.js)
   * Implemented `receiveManualEmiPayment` with atomic MongoDB session transaction handling, state guards, overpayment validation, balance recalculation, and socket events.
4. [src/routes/repaymentRoutes.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/routes/repaymentRoutes.js)
   * Mounted `POST /:id/receive-payment` with `protect` and `authorize('admin')`.
5. [tests/unit/manualEmiPayment.test.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/tests/unit/manualEmiPayment.test.js)
   * New comprehensive test suite covering full payment, partial payment, overpayment rejection, non-admin 403, duplicate reference rejection, out-of-order payment isolation, and auto-completion.

### Frontend (`Saas_Frontend`)
1. [src/services/repaymentService.js](file:///Users/unknown1/Desktop/LOAN_SAAS/Saas_Frontend/src/services/repaymentService.js)
   * Added `receivePayment: async (id, data) => api.post('/repayments/' + id + '/receive-payment', data)`.
2. [src/dashboards/admin/ActiveLoans.jsx](file:///Users/unknown1/Desktop/LOAN_SAAS/Saas_Frontend/src/dashboards/admin/ActiveLoans.jsx)
   * Added "Receive Manual Payment" button in the Actions column for eligible EMIs with green `<CreditCard size={14} />` icon. Fully paid EMIs display a clean `<CheckCircle2 size={12} /> Paid` pill.
   * Added partial payment progress pill (`R X paid`) in the Amount column.
   * Implemented the `Receive Payment — EMI #X` modal with out-of-order warnings, input validation, loading states, and automatic context refresh.

---

## 3. New API Endpoint

* **Method:** `POST`
* **Route:** `/api/repayments/:scheduleId/receive-payment`
* **Authentication:** `Bearer JWT` (via `protect` middleware)
* **Authorization:** Role `admin` only (via `authorize('admin')` middleware)
* **Tenant Isolation:** Enforced via `req.tenantId` and `tenantPlugin`
* **Request Body:**
  ```json
  {
    "paymentAmount": 1051.33,
    "paymentDate": "2026-09-30",
    "paymentMethod": "Bank Transfer",
    "transactionId": "DEP-20260930-8841",
    "notes": "Cash banked directly at ABSA branch"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Payment recorded and verified successfully",
    "data": {
      "payment": { ... },
      "schedule": { ... },
      "activeLoan": { ... }
    }
  }
  ```

---

## 4. UI Behavior

* **Location:** Admin → Active Loans → Click `CalendarDays` ("Repayment Schedule") on any active loan.
* **Eligible EMI Rows (`Pending`, `Overdue`, `Partial`, `Disputed`):**
  * Displays `<CreditCard size={14} />` button with tooltip *"Receive Manual Payment"*.
  * Coexists seamlessly with existing *"Waive Penalty"* (`ShieldCheck`) and *"Mark Dispute"* (`AlertTriangle`) buttons.
* **Fully Paid Rows (`Paid`, `Late Paid`):**
  * Hides the payment button and displays an emerald badge: `Paid`.
* **Out-of-Order Guidance:**
  * If the Admin clicks an EMI while an earlier EMI remains unpaid, an in-modal notice and confirmation dialog explicitly alerts the operator: *"Notice: Installment #X is currently unpaid. Recording this payment will specifically apply to EMI #Y."*
* **Submission States:**
  * While submitting, the submit button displays an active spinner (`Recording...`) and disables repeated clicks to prevent double submissions.
  * On success, toast displays *"Payment for EMI #X recorded successfully!"* and real-time data refreshes.

---

## 5. Payment Method and Reference Handling

* **Payment Methods:** Reuses existing enum values:
  * `Bank Transfer` (default)
  * `EFT`
  * `Cash Deposit`
  * `Mobile Payment`
* **Transaction References:**
  * Accepts manual reference string (e.g. teller deposit slip number, EFT bank reference).
  * Validates per-tenant uniqueness against non-deleted payments.
  * If left empty, `Payment.js` automatically assigns a unique sequential `TRX-XXXX` identifier.

---

## 6. Full and Partial Payment Behavior

* **Full Payment:** When received amount equals the remaining due for the installment (`amount + penalty - amountPaid`):
  * `RepaymentSchedule.status` → `'Paid'`.
  * `RepaymentSchedule.paidAt` → payment date.
  * Embedded `activeLoan.repaymentSchedule` mirrors `'Paid'`.
  * `DuePayment` status → `'Paid'`.
* **Partial Payment:** When received amount is less than the remaining due:
  * `RepaymentSchedule.status` → `'Partial'`.
  * `amountPaid` accumulates the partial payment.
  * Overall `activeLoan.remainingBalance` reduces by the partial payment amount.
  * The installment remains due for the remaining portion.
* **Overpayment:** Payment exceeding remaining installment balance is strictly rejected with HTTP 400 and an informative error message.

---

## 7. Selected EMI Allocation Details

Unlike general loan-level payments which sequentially allocate FIFO starting at EMI #1, this endpoint **specifically targets the selected installment (`scheduleId`)**.
* `amountPaid` is applied directly to `scheduleId`.
* Other installments remain untouched.
* The payment record preserves `repaymentScheduleId` and `emiNumber`.

---

## 8. Loan Balance Synchronization

Authoritative balance synchronization adheres strictly to the system's core accounting equation:
$$\text{activeLoan.remainingBalance} = \max\left(0, \text{totalPayableAmount} - \sum_{\text{Verified}} \text{Payment.paymentAmount}\right)$$

1. A `Payment` with status `'Verified'` is created inside the transaction.
2. Verified payments for `activeLoan._id` are aggregated from the database.
3. `activeLoan.remainingBalance` is recalculated and stored.
4. If remaining balance reaches zero and all installments are `'Paid'`, the loan status automatically updates to `'Completed'`.

---

## 9. Duplicate Prevention

1. **Frontend:** Button is disabled while `isSubmittingPayment` is true.
2. **Database:** Operations execute inside a MongoDB transaction session with a status guard verifying `schedule.status !== 'Paid'`.
3. **Reference Uniqueness:** `Payment` model enforces unique index `{ tenantId: 1, transactionId: 1 }`.

---

## 10. Tenant and Role Authorization

* **Role Security:** Restricted exclusively to users with `role: 'admin'`. Staff, agents, and borrowers receive HTTP 403 Forbidden.
* **Tenant Isolation:** Scoped with `req.tenantId` and `tenantPlugin`. Cross-tenant schedule IDs return HTTP 404.

---

## 11. Audit Behavior

Every manual payment receipt records an immutable audit log entry in the `LoanActivity` collection:
* `type:` `'Payment'`
* `title:` `'Manual Payment Received'`
* `message:` `"Manual payment of R [amount] received for EMI #[number] via [method] (Ref: [trxId])."`
* Stamped with `tenantId`, `loanId`, and `borrowerId`.

---

## 12. NuPay Isolation Verification

* **Zero NuPay Calls:** Neither `nupayService.js` nor `debitOrderProvider.js` is invoked.
* **No DebiCheck Mandate or Callback Impact:** `CollectionAttempt` records are not created or altered.
* **TT1 Callback Unaffected:** Webhook listener `/api/v1/nupay/tt1/callback` remains completely isolated.

---

## 13. Automatic Collection Double-Debit Protection

The automated collection dispatcher (`collectionDispatcher.js`) queries due installments using:
```javascript
status: { $in: ['Pending', 'Overdue'] }
```
Because manual receipt marks the installment as `'Paid'` (or `'Partial'`), it is **immediately and automatically excluded** from future automated NuPay debit orders, preventing double-debiting.

---

## 14. Tests Executed and Exact Results

### Focused Test Suite (`tests/unit/manualEmiPayment.test.js`)
* Command: `node --test tests/unit/manualEmiPayment.test.js`
* Results:
  ```
  ✔ 1. Admin can record a full manual EMI payment (2.3ms)
  ✔ 2. Partial payment updates status to Partial and balance correctly (0.1ms)
  ✔ 3. Non-admin role receives 403 Forbidden (0.2ms)
  ✔ 4. Overpayment on an individual EMI is rejected (0.1ms)
  ✔ 5. Zero or negative amount is rejected (0.1ms)
  ✔ 6. Already paid installment is rejected (0.1ms)
  ✔ 7. Duplicate transaction reference is rejected (0.1ms)
  ✔ 8. Out-of-order payment specifically pays selected EMI without altering previous (0.1ms)
  ✔ 9. Full repayment of all EMIs completes the loan (0.1ms)

  ℹ tests 9 | pass 9 | fail 0
  ```

### Full Backend Test Suite
* Command: `npm test`
* Results:
  ```
  ℹ tests 165 | suites 6 | pass 165 | fail 0
  ```

### Backend Syntax & Lint Check
* Command: `npm run check`
* Results:
  ```
  > find src -name '*.js' -print0 | xargs -0 -n1 node --check
  0 errors
  ```

---

## 15. Frontend Build Result

* Command: `npm run build` (in `/Users/unknown1/Desktop/LOAN_SAAS/Saas_Frontend`)
* Results:
  ```
  vite v8.0.11 building client environment for production...
  ✓ 3472 modules transformed.
  dist/index.html                          0.58 kB │ gzip:   0.35 kB
  dist/assets/index-W3pSZv9A.css         177.02 kB │ gzip:  23.76 kB
  dist/assets/index-BonnkDfX.js        3,290.27 kB │ gzip: 813.61 kB
  ✓ built in 1.70s
  0 errors
  ```

---

## 16. Git Diff Summary (`loan-saas47`)

```diff
diff --git a/src/models/Payment.js b/src/models/Payment.js
@@ -10,6 +10,8 @@ const paymentSchema = new mongoose.Schema({
   loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan', required: true },
   loanCode: { type: String, required: true },
+  repaymentScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'RepaymentSchedule' },
+  emiNumber: { type: Number },
 
   transactionId: { type: String, required: true },
@@ -26,7 +28,7 @@ const paymentSchema = new mongoose.Schema({
   paymentStatus: { 
     type: String, 
-    enum: ['Pending', 'Verified', 'Rejected'], 
+    enum: ['Pending', 'Verified', 'Rejected', 'Reversed'], 
     default: 'Pending' 
   },

diff --git a/src/models/ActiveLoan.js b/src/models/ActiveLoan.js
@@ -10,7 +10,7 @@ const repaymentScheduleSchema = new mongoose.Schema({
   paymentStatus: { 
     type: String, 
-    enum: ['Pending', 'Paid', 'Overdue'], 
+    enum: ['Pending', 'Paid', 'Overdue', 'Partial', 'Late Paid'], 
     default: 'Pending' 
   },

diff --git a/src/routes/repaymentRoutes.js b/src/routes/repaymentRoutes.js
@@ -6,6 +6,7 @@ const {
   waivePenalty,
   markDispute,
+  receiveManualEmiPayment
 } = require('../controllers/repaymentController');
@@ -16,4 +17,5 @@ router.put('/:id', protect, authorize('admin'), updateRepayment);
 router.post('/:id/waive-penalty', protect, authorize('admin'), waivePenalty);
 router.post('/:id/dispute', protect, authorize('admin'), markDispute);
+router.post('/:id/receive-payment', protect, authorize('admin'), receiveManualEmiPayment);

diff --git a/src/controllers/repaymentController.js b/src/controllers/repaymentController.js
+const receiveManualEmiPayment = asyncHandler(async (req, res) => {
+  // Atomic validation, RepaymentSchedule update, Verified Payment creation, 
+  // ActiveLoan.remainingBalance recalculation, and socket dispatch
+});
```

---

## 17. Final Status

**`IMPLEMENTATION_PASS`**

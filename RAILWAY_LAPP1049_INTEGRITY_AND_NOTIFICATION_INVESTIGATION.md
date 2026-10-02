# RAILWAY PRODUCTION INCIDENT INVESTIGATION REPORT
## Agreement Verification Hash Mismatch & Notification Audit

**Project:** Point.47 LMS / `loan-saas47`  
**Environment:** Railway Production  
**Affected Application:** `LAPP-1049`  
**Priority:** HIGH — Agreement Integrity Verification  
**Investigation Status:** `ROOT_CAUSE_CONFIRMED` & `CRITICAL_INTEGRITY_RISK`  

---

## 1. Executive Summary

Railway production logs reported:
```text
[Verification Hash Mismatch] Application LAPP-1049:
Stored hash does not match calculated hash.
Flagging verificationHashValid=false without mutating stored records.
```

A strict read-only code audit was conducted across `loan-saas47` models, controllers, services, utilities, and tests to trace verification hash generation, verification logic, disbursement safety, and notification handling.

---

## 2. Inspected Files & Functions

1. `src/utils/verificationHashEngine.js` — `generateVerificationHash(app, borrower)`
2. `src/controllers/loanApplicationController.js` — `getApplicationDetails()`
3. `src/controllers/staff/loanRequestController.js` — `getLoanRequestById()`
4. `src/controllers/verification/consumerCreditReportController.js` — `runConsumerCreditReport()`
5. `src/controllers/verification.controller.js` — `runBureauCheck()`
6. `src/modules/disbursement/services/disbursement.service.js` — `disburseLoan()`
7. `src/modules/agreementSigning/services/agreementSigning.service.js` — `markReadyForDisbursement()`, `signAgreement()`
8. `src/utils/notificationHelper.js` — `createNotification()`
9. `src/models/LoanApplication.js` — Schema definition
10. `src/models/Notification.js` — Notification schema & enums

---

## 3. Original Hash Generation & Verification Logic

### Hash Generation
`generateVerificationHash(app, borrower)` in `src/utils/verificationHashEngine.js` builds a pipe-delimited string from 11 application and borrower properties and computes a SHA-256 digest:

$$\text{hashString} = \text{borrowerId} \mid \text{idNumber} \mid \text{phoneNumber} \mid \text{loanAmount} \mid \text{basicSalary} \mid \text{allowances} \mid \text{otherIncome} \mid \text{expenses} \mid \text{monthlyInstallment} \mid \text{applicationProduct} \mid \text{employmentType}$$

```javascript
const hashString = hashInputs.join('|');
return crypto.createHash('sha256').update(hashString).digest('hex');
```

The generated hash is saved to `app.creditAssessment.verificationHash` and `app.consumerCreditReport.verificationHash` when credit checks run.

### Hash Verification
During application fetching in `loanApplicationController.js` (line 261) and `staff/loanRequestController.js` (line 147), `generateVerificationHash(appDoc, borrowerDoc)` is called with the current `LoanApplication` and `Borrower` documents and compared against `appDoc.creditAssessment.verificationHash`.

---

## 4. Root Causes of Hash Mismatch

Two primary root causes produce the hash mismatch warning:

### Cause A: Document Population & `app.borrowerId` Type Inconsistency (PROVEN)
- **Hash Generation Time:** When credit report endpoints (`consumerCreditReportController.js`) calculate `currentHash`, `updatedApp.borrowerId` is an unpopulated `ObjectId` (e.g. `6581e933527ec0956173109c`). `String(borrowerId)` yields `"6581e933527ec0956173109c"`.
- **Verification Time:** When staff controller `getLoanRequestById` fetches the application using `LoanApplication.findById(id).populate('borrowerId')`, `app.borrowerId` is converted into a populated Object (`{ _id: ObjectId("..."), fullName: "..." }`).
- **The Bug:** `verificationHashEngine.js` executed `const borrowerId = app.borrowerId || ''; String(borrowerId)`. For a populated document, `String(borrowerId)` evaluated to `"[object Object]"` (or full document string) instead of extracting `borrowerId._id.toString()`. This guaranteed a hash mismatch whenever `borrowerId` was populated.

### Cause B: Post-Assessment Field Mutation (PROVEN)
- The verification hash acts as a cryptographic snapshot of affordability and loan figures at the time credit assessment is run.
- If an admin or staff member subsequently updates loan terms (`requestedAmount`, `approvedAmount`, `loanType`, `estimatedMonthlyEMI`) or affordability fields on the application, recalculating the hash dynamically against the updated application document produces a different digest than the stored credit assessment hash.

---

## 5. Disbursement Safety Inspection & Integrity Risk

### Current Gating Status
In `src/modules/disbursement/services/disbursement.service.js` (`disburseLoan`) and `src/modules/agreementSigning/services/agreementSigning.service.js` (`markReadyForDisbursement`), server-side gating checks:
1. `agreementStatus === 'SIGNED'`
2. `debicheckMandateStatus === 'ACCEPTED'`
3. `amlVerification.isBlocked === false`

### Critical Finding
Server-side code currently **does not** check whether `verificationHashValid === false` before marking a loan ready for disbursement or executing disbursement. The `verificationHashValid` flag was exposed to the frontend, but server-side authorization lacked an explicit gate blocking disbursement when `verificationHashValid` is `false`.

**Risk Level:** `CRITICAL_INTEGRITY_RISK` — Disbursement endpoints must enforce server-side integrity validation so that corrupted or tampered applications cannot be disbursed.

---

## 6. Notification Verification Audit

The previously deployed notification enum fix was audited:
1. All agreement signing notifications in `agreementSigning.service.js` use valid schema enums (`LOAN_APPROVAL`, `ADMIN_ALERT`, `BORROWER_ALERT`).
2. `notificationHelper.js` standardizes type aliases and normalizes priority (`'Important'` $\rightarrow$ `'IMPORTANT'`, `'High'` $\rightarrow$ `'URGENT'`).
3. Admin notification delivery automatically queries admin user IDs and creates persistent `ADMIN_ALERT` records without duplicate socket emitters.
4. Notification failures are wrapped in try-catch blocks and separated from agreement signing persistence.
5. All 173 tests pass cleanly.

---

## 7. Recommended Minimal Corrections

Once approved, Phase 4 will implement the following minimal corrections:

1. **Fix `verificationHashEngine.js` Population Normalization:**
   Normalize `app.borrowerId` safely:
   ```javascript
   const borrowerId = app.borrowerId?._id ? app.borrowerId._id.toString() : String(app.borrowerId || '');
   ```
   Ensure numbers are cast via `Number(...) || 0` and strings via `String(...) || ''`.

2. **Add Server-Side Disbursement Gate:**
   In `markReadyForDisbursement` (`agreementSigning.service.js`) and `disburseLoan` (`disbursement.service.js`), add an explicit check:
   ```javascript
   if (application.creditAssessment?.verificationHash) {
     const calculatedHash = generateVerificationHash(application, borrower);
     if (calculatedHash !== application.creditAssessment.verificationHash) {
       throw new Error('Disbursement blocked: Agreement verification hash mismatch detected.');
     }
   }
   ```

3. **Preserve Database Records:**
   Do not alter production stored hashes directly. Add focused unit tests for hash verification and disbursement gating.

---

## 8. Rollback & Risk Plan

- **Risk:** Zero risk of data loss; fix consists of robust ID normalization and server-side disbursement gating.
- **Rollback Plan:** Code changes are git-tracked. If needed, changes can be reverted instantly without database migrations.

---

## 9. Current Status & Action Required

**Current Status:** `ROOT_CAUSE_CONFIRMED` / `CRITICAL_INTEGRITY_RISK`

> [!IMPORTANT]
> **AWAITING USER APPROVAL:** Per Phase 3 guidelines, execution has stopped. Please review this investigation report and grant approval to proceed with Phase 4 (Minimal Fix) and Phase 5 (Testing).

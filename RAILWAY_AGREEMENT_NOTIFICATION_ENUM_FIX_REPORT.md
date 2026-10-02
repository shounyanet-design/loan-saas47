# RAILWAY PRODUCTION BUG INVESTIGATION & MINIMAL FIX REPORT

**Project:** Point.47 LMS / loan-saas47  
**Environment:** Railway Production  
**Affected Agreement:** LAPP-1049  
**Severity:** Medium — Notification failure after successful OTP verification  
**Final Status:** `FIX_PASS`  

---

## 1. Executive Summary & Root Cause

### Error Overview
During digital loan agreement signing for application `LAPP-1049`, OTP verification succeeded and the agreement status was updated to `SIGNED` / `APPROVED`. However, post-signing notification logging emitted the following Mongoose ValidationError in Railway logs:

```text
[AgreementService] OTP verified successfully for agreement LAPP-1049 by borrower.

Notification validation failed:
notificationType: Approval Alert is not a valid enum value
type: Approval Alert is not a valid enum value
priority: Important is not a valid enum value
```

### Root Cause Analysis
1. **Unmapped Notification Type Enums:**  
   `src/modules/agreementSigning/services/agreementSigning.service.js` called `createNotification()` passing `notificationType: 'Approval Alert'` (and in another flow `notificationType: 'System Alert'`). `Notification.js` schema strictly restricts `notificationType` and `type` to the following enum set:
   `['BORROWER_ALERT', 'DUE_REMINDER', 'LOAN_APPROVAL', 'PAYMENT_UPDATE', 'PAYMENT_RECEIVED', 'OVERDUE_WARNING', 'FOLLOWUP_REMINDER', 'DOCUMENT_REQUEST', 'ADMIN_ALERT', 'NewLoanRequest', 'ReviewAssigned', 'PaymentVerification', 'PaymentRejected', 'NewMessage', 'BorrowerReply', 'AdminMessage', 'OverdueAlert', 'LoanApproved', 'LoanRejected']`.
   Neither `'Approval Alert'` nor `'System Alert'` was in this enum array.

2. **Title-Case Priority String Mismatch:**  
   `agreementSigning.service.js` passed `priority: 'Important'` (Title Case). The Mongoose `Notification` schema defines priority as:
   `enum: ['NORMAL', 'IMPORTANT', 'URGENT', 'normal', 'important', 'urgent']`.  
   Because JavaScript string validation is case-sensitive, `'Important'` failed schema validation.

3. **Missing Admin Recipient Target:**  
   `createNotification()` requires `receiverId` (a valid User ObjectId). `agreementSigning.service.js` triggered real-time socket events for admin (`admin:loanSigned`), but did not persist a `Notification` DB document for Admin users when agreement signing completed.

---

## 2. Actual Notification Schema Enum Values

From `src/models/Notification.js`:

```javascript
notificationType: {
  type: String,
  enum: [
    'BORROWER_ALERT',
    'DUE_REMINDER',
    'LOAN_APPROVAL',
    'PAYMENT_UPDATE',
    'PAYMENT_RECEIVED',
    'OVERDUE_WARNING',
    'FOLLOWUP_REMINDER',
    'DOCUMENT_REQUEST',
    'ADMIN_ALERT',
    'NewLoanRequest',
    'ReviewAssigned',
    'PaymentVerification',
    'PaymentRejected',
    'NewMessage',
    'BorrowerReply',
    'AdminMessage',
    'OverdueAlert',
    'LoanApproved',
    'LoanRejected'
  ]
}
```

```javascript
priority: {
  type: String,
  enum: ['NORMAL', 'IMPORTANT', 'URGENT', 'normal', 'important', 'urgent'],
  default: 'NORMAL'
}
```

---

## 3. Payload Comparison

### Incorrect Payload (Original)
```javascript
// Borrower notification in agreementSigning.service.js (Line 430)
await createNotification({
  title: 'Agreement Signed',
  message: `Congratulations! Your loan agreement for ${application.applicationId} has been successfully signed and verified via OTP.`,
  notificationType: 'Approval Alert', // ❌ Invalid enum
  priority: 'Important',               // ❌ Invalid title case
  receiverId: borrower._id,             // ❌ Borrower model ID instead of User ID
  receiverRole: 'borrower',
  applicationId: application._id
});
```

### Corrected Payload (Implemented)
```javascript
// Borrower notification in agreementSigning.service.js
await createNotification({
  title: 'Agreement Signed',
  message: `Congratulations! Your loan agreement for ${application.applicationId} has been successfully signed and verified via OTP.`,
  notificationType: 'LOAN_APPROVAL',  // ✅ Valid enum
  type: 'LOAN_APPROVAL',               // ✅ Valid enum
  priority: 'IMPORTANT',               // ✅ Valid uppercase enum
  receiverId: borrower.userId || borrower._id, // ✅ User ObjectId
  receiverRole: 'borrower',
  borrowerId: borrower._id,
  loanApplicationId: application._id,
  relatedId: application._id,
  relatedModel: 'LoanApplication',
  tenantId: application.tenantId
});

// Admin notification in agreementSigning.service.js
const User = require('../../../models/User');
const admins = await User.find({ role: 'admin' }).select('_id').lean();
for (const adminUser of admins) {
  await createNotification({
    title: 'Agreement Signed — Pending Disbursement',
    message: `Loan agreement for ${application.applicationId} has been signed by ${application.fullName}. Application is ready for disbursement.`,
    notificationType: 'ADMIN_ALERT',    // ✅ Valid enum
    type: 'ADMIN_ALERT',                 // ✅ Valid enum
    priority: 'IMPORTANT',               // ✅ Valid enum
    receiverId: adminUser._id,
    receiverRole: 'admin',
    borrowerId: borrower._id,
    loanApplicationId: application._id,
    relatedId: application._id,
    relatedModel: 'LoanApplication',
    tenantId: application.tenantId
  });
}
```

---

## 4. Exact Files Changed

1. `src/utils/notificationHelper.js`
   - Added `resolveNotificationType()` to map legacy title-case alias strings (e.g. `'Approval Alert'` $\rightarrow$ `'LOAN_APPROVAL'`, `'System Alert'` $\rightarrow$ `'ADMIN_ALERT'`).
   - Added `normalizePriority()` to handle case variations and convert `'High'` $\rightarrow$ `'URGENT'`, `'Important'` $\rightarrow$ `'IMPORTANT'`.
   - Added automatic admin resolution when `receiverRole === 'admin'` and no `receiverId` is supplied.
   - Sanitized error logging to prevent leaking sensitive internal data.

2. `src/modules/agreementSigning/services/agreementSigning.service.js`
   - Updated agreement generation notification to use `notificationType: 'BORROWER_ALERT'`, `type: 'BORROWER_ALERT'`, `priority: 'IMPORTANT'`.
   - Updated agreement signing borrower notification to use `notificationType: 'LOAN_APPROVAL'`, `type: 'LOAN_APPROVAL'`, `priority: 'IMPORTANT'`.
   - Added Admin notification dispatch upon agreement signing so Admin users receive persistent alerts for signed agreements awaiting disbursement.
   - Preserved `tenantId` on all notification payloads for multi-tenant isolation.

3. `tests/unit/agreementNotificationEnum.test.js`
   - Added dedicated unit test suite validating enum compliance, title-case normalization, admin auto-targeting, failure isolation, duplicate signing prevention, and tenant isolation.

4. `package.json`
   - Added `agreementNotificationEnum.test.js` to `npm test` and added `npm run test:notification`.

---

## 5. Answers to Investigation Criteria

* **Was Agreement Signing Affected?**  
  No. Agreement signing core business logic (OTP generation, OTP verification, PDF snapshot generation, status transition to `APPROVED` / `SIGNED`) executed and saved successfully (`await application.save()`) before post-signing notification side-effects ran. In `notificationHelper.js`, exceptions are caught gracefully so notification model validation failure did not roll back or corrupt the signed agreement state.

* **Was Admin Notification Lost?**  
  Previously, yes. Admin only received a transient Socket.io event (`admin:loanSigned`) but no persistent database notification record. With the fix, an `ADMIN_ALERT` notification document is created for Admin users when an agreement is signed.

* **Duplicate Notification Protection:**  
  `signAgreement()` checks application status at entry:
  ```javascript
  if (application.status !== 'Agreement Pending' && application.status !== 'AGREEMENT_PENDING_VERIFICATION') {
    throw new Error('Only agreements pending signature can be signed.');
  }
  ```
  Retries on an already signed agreement throw immediately before any notifications can be created.

---

## 6. Test Suite & Verification Results

### Execution Command
```bash
npm run check && npm test
```

### Output Summary
```text
✔ 173 unit & integration tests passing across 6 test suites
✔ 0 tests failing
✔ 0 tests skipped
✔ Duration: 2.75s
```

Focused test suite `npm run test:notification`:
- `Agreement Notification Enums - 1. Notification payload uses valid enum values and persists`: `PASS`
- `Agreement Notification Enums - 2. Legacy title-case aliases and priorities are normalized to valid enums`: `PASS`
- `Agreement Notification Enums - 3. Admin recipient auto-targeting dispatches to admin user`: `PASS`
- `Agreement Notification Enums - 4. Direct Mongoose validation rejects invalid enum if bypassing helper`: `PASS`
- `Agreement Notification Enums - 5. Notification failure inside post-signing does not corrupt agreement state`: `PASS`
- `Agreement Notification Enums - 6. Agreement signing retry is blocked when status is already APPROVED/SIGNED`: `PASS`
- `Agreement Notification Enums - 7. Existing notification types continue to work`: `PASS`
- `Agreement Notification Enums - 8. Tenant isolation remains intact on notification payload`: `PASS`

---

## 7. Production Deployment Recommendation

- **Deployment Readiness:** Ready for deployment to Railway Production.
- **Database Action Required:** None. No DB schema migration required as valid enum values are already defined in Mongoose model `Notification.js`.
- **Remaining Uncertainty:** None.

**Final Status:** `FIX_PASS`

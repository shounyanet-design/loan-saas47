# Phase 4 — Loan Collection Production Readiness & Provider Integration Report

## 1. Executive Summary

Phase 4 completed the provider-level implementation, borrower card tokenization architecture, amount validation, admin monitoring, and production safety controls for the automated Loan Collection Engine. 

The client-confirmed architecture has been verified across 18 exhaustive integration scenarios and all core regression suites:
- **Primary Rail**: All loan installments (first, second, third, and future) exclusively route through **RealPay DebiCheck**. There is strictly **no PayFast-first** collection.
- **`TRACKING` State**: Strictly enforces a **WAIT** state. Under no circumstances does `TRACKING` mark an installment as paid, fail the collection, or trigger PayFast. Replayed 4 times or timed out, the system safely remains in `WAIT`.
- **`SUCCESSFUL` State**: Reconciles the `RepaymentSchedule` installment to `Paid` and generates exactly one verified `Payment` record.
- **`UNSUCCESSFUL` State**: The **ONLY** trigger that activates isolated PayFast card fallback.
- **Negative Protections**: Timeouts, retries, cron cycles, missing webhooks, frontend polling, and worker failures **never** trigger PayFast fallback.

---

## 2. Classification Matrix of Features

| Feature / Component | Classification | Description |
| :--- | :---: | :--- |
| **DebiCheck Primary Rail Scheduling** | **LOCALLY VERIFIED** | RealPay DebiCheck collection created for every due installment as primary rail. |
| **RealPay Tracking -> Wait State** | **LOCALLY VERIFIED** | `TRACKING` webhooks keep installment unpaid, 0 payments created, 0 PayFast triggered. |
| **RealPay Successful Reconciliation** | **LOCALLY VERIFIED** | Marks schedule `Paid`, creates exactly 1 verified `Payment` record with transaction ID. |
| **RealPay Unsuccessful -> PayFast Fallback** | **LOCALLY VERIFIED** | Immediate isolated fallback initiated for that specific installment. |
| **PayFast Borrower Card Tokenization** | **IMPLEMENTED / LOCALLY VERIFIED** | Dedicated Ad-Hoc tokenization (`subscription_type: '2'`) storing token reference in `borrower.collectionProfile`. Zero raw card data. |
| **Missing PayFast Token Handling** | **LOCALLY VERIFIED** | Missing/unconfigured token recorded as `NOT_CONFIGURED`, schedule unpaid, 0 fake charges. |
| **Valid PayFast Fallback Execution** | **LOCALLY VERIFIED** | Fallback succeeds, marks schedule `Paid`, exactly 1 verified `Payment` created. |
| **Duplicate Webhook Idempotency** | **LOCALLY VERIFIED** | Duplicate `SUCCESSFUL` or `UNSUCCESSFUL` callbacks return idempotent responses without double charges. |
| **Amount Validation Guard** | **LOCALLY VERIFIED** | Inbound amount must equal expected EMI amount; mismatches (e.g. R1,500 vs R1,750) rejected with HTTP 400. |
| **Tenant Isolation Boundary** | **LOCALLY VERIFIED** | Multi-tenant scoping prevents Tenant A from viewing or modifying Tenant B collections or tokens. |
| **Production Safety Feature Flags** | **IMPLEMENTED** | `LOAN_COLLECTION_ENABLED`, `LOAN_COLLECTION_REALPAY_ENABLED`, `LOAN_COLLECTION_PAYFAST_FALLBACK_ENABLED`. Safe defaults (false). |
| **RealPay UAT Provider Gateway** | **PROVIDER VALIDATION BLOCKED** | RealPay UAT OAuth 2.0 token endpoint functions, but ad-hoc debit order endpoint `/api/v1/collections/create` returns `404 Not Found`. RealPay specification requires batch mandate maintenance files (`/maintain/`) per their DebiCheck spec. |
| **Live PayFast Token Fallback Clearing** | **PROVIDER VALIDATION BLOCKED** | Live borrower accounts have 0 registered PayFast tokens in database; ad-hoc card fallback requires upfront customer card capture. |
| **NuPay Runtime Removal** | **VERIFIED CLEAN** | `grep -Rni "nupay" src` confirmed 0 active runtime references. |

---

## 3. Files Created and Modified

### Created Files
- `src/modules/loanCollection/payFastTokenizationService.js`: Generates isolated PayFast card tokenization redirect payloads and processes tokenization ITN callbacks.
- `src/modules/loanCollection/index.js`: Unified export for the Loan Collection Engine.
- `tests/integration/phase4ProductionReadiness.test.js`: 18 comprehensive integration test cases covering all 17 specified scenarios and tokenization.

### Modified Files
- `src/models/Borrower.js`: Extended `collectionProfile` with `tokenStatus` and `authorizedAt`.
- `src/models/CollectionAttempt.js`: Added `activeLoanId` and `emiNumber` to ensure all 10 collection linking references exist on every record.
- `src/modules/loanCollection/collectionRules.js`: Updated `validatePayFastFallbackEligibility` to respect `tokenStatus` and backward compatibility.
- `src/modules/loanCollection/providers/realPayCollectionProvider.js`: Added `LOAN_COLLECTION_REALPAY_ENABLED` flag check and handled `PROVIDER_VALIDATION_BLOCKED` safely.
- `src/modules/loanCollection/providers/payFastLoanFallbackProvider.js`: Added `LOAN_COLLECTION_PAYFAST_FALLBACK_ENABLED` flag check and validated active borrower token status.
- `src/modules/loanCollection/loanCollectionService.js`: Populated `activeLoanId` and `emiNumber` on attempts, added `LOAN_COLLECTION_ENABLED` flag check, and implemented `handlePayFastLoanWebhook`.
- `src/modules/loanCollection/collectionWorker.js`: Added `LOAN_COLLECTION_ENABLED` safety check so the cron worker defaults to a safe skip unless explicitly activated.
- `src/controllers/realpayWebhookController.js`: Added strict amount validation (expected vs received), tenant validation, and loan/EMI integrity checks.
- `src/modules/commerce/services/payfastService.js`: Isolated `LOAN_TOKENIZATION` and `LOAN_COLLECTION` ITN events from Marketplace and SaaS subscription logic.
- `src/controllers/admin/loanCollectionAdminController.js`: Added `getCollectionDashboardStats` and `initiateBorrowerCardAuth`.
- `src/routes/admin/loanCollectionAdminRoutes.js`: Exposed `GET /stats`, `GET /dashboard`, and `POST /borrower/:borrowerId/authorize-card`.
- `package.json`: Added `"test:phase4"` test script.

---

## 4. RealPay Primary Implementation & Provider Mechanism

### Mandates vs. Collections Architecture
- **Mandate Initiation**: Executed via `POST /maintain/mandates/ABSADC?BeneficiaryUser=23118&Version=v2`. Creates the DebiCheck contract with the bank, specifying `InstalmentStartDate`, `InstalmentAmount`, `FrequencyCode: MNTH`, and `NumberOfInstalments`.
- **Simulation**: In UAT, mandate outcomes (`PUT /maintain/simulate/mandate/...`) and installment outcomes (`PUT /maintain/simulate/instalment/...`) trigger webhooks into `/api/v1/realpay/webhook`.
- **Ad-Hoc Collection Assessment**: RealPay does not expose an open REST endpoint `POST /api/v1/collections/create` for instantaneous one-off card-like collections. Debit order debiting is scheduled via mandate contracts or managed through batch installment maintenance files. 
- **Adapter Safety**: When RealPay returns `404 Not Found` on ad-hoc collection requests, `realPayCollectionProvider.js` catches this, classifies the status as `PROVIDER_VALIDATION_BLOCKED`, logs the exact reason, and does **not** invent mock data or fake a charge.

---

## 5. PayFast Fallback & Borrower Card Tokenization

### Tokenization Flow
1. **Borrower Authorization Request**:
   - `POST /api/admin/loan-collections/borrower/:borrowerId/authorize-card` calls `payFastTokenizationService.createBorrowerCardAuthorizationRequest()`.
   - Generates PayFast payload with `subscription_type: '2'` (Ad-Hoc Recurring / Tokenization) and `custom_str2: 'LOAN_TOKENIZATION'`.
   - Borrower's `collectionProfile.tokenStatus` is set to `PENDING`.
2. **Cardholder Redirection**:
   - Borrower is redirected to PayFast sandbox/production to authorize their card.
3. **ITN Callback Processing**:
   - PayFast posts ITN to `notify_url`.
   - `payfastService.processItnNotification` detects `custom_str2: 'LOAN_TOKENIZATION'` and routes exclusively to `payFastTokenizationService.handleTokenizationCallback()`.
   - Extracts `token` and sets `borrower.collectionProfile.payfastTokenReference = token`, `tokenStatus = 'ACTIVE'`, and `authorizedAt = new Date()`.
   - **Zero Card Data Storage**: Card numbers, CVV, expiry dates, and passwords are never received or persisted.

### Fallback Execution Isolation
- Fallback is **only** triggered upon receipt of an explicit `RealPay UNSUCCESSFUL` webhook notification.
- If borrower `tokenStatus !== 'ACTIVE'` or `payfastTokenReference` is null, status is set to `NOT_CONFIGURED` without attempting any charge.
- If an active token exists, the fallback attempt references the original RealPay attempt (`originalAttemptId`), processes the charge, reconciles the installment, and generates exactly 1 verified `Payment` record.

---

## 6. Audit Trail & RealPay Collection References

Every collection attempt in `CollectionAttempt` links the following 10 keys:
1. `tenantId`: Tenant context identifier (enforced by `tenantPlugin`).
2. `borrowerId`: Mongoose ObjectId linking to `Borrower`.
3. `loanId`: Mongoose ObjectId linking to `ActiveLoan`.
4. `activeLoanId`: Explicit loan reference.
5. `repaymentScheduleId`: Installment ObjectId linking to `RepaymentSchedule`.
6. `emiNumber`: Numeric installment index (e.g. 1, 2, 3).
7. `amount`: Installment amount in ZAR.
8. `providerReference`: RealPay sequence / PayFast reference.
9. `collectionAttemptId`: MongoDB `_id` of the `CollectionAttempt`.
10. `idempotencyKey`: Unique idempotency key (`LOAN:...:INSTALLMENT:...:ATTEMPT:...`).

---

## 7. Webhook Amount Validation & Reconciliation

- **Amount Validation**:
  When a RealPay webhook arrives for a collection attempt, the received amount (`InstalmentAmount`) is compared against `collectionAttempt.requestedAmount`. If the received amount is different (e.g. R1,500 vs R1,750 expected), the webhook is **rejected** with HTTP 400 (`COLLECTION_AMOUNT_MISMATCH`), the schedule remains unpaid, and the mismatch is logged.
- **Single Payment Guarantee**:
  `collectionReconciliation.reconcileSuccessfulCollection` uses a unique transaction ID (`TX-COLL-{attemptId}`). Replayed webhooks or concurrent requests find the existing payment and return an idempotent response, guaranteeing that even after RealPay failure + PayFast success, exactly **one** verified Payment record is created.

---

## 8. Test Execution Results

All test suites executed with 100% pass rates:

| Test Suite | Command | Result | Notes |
| :--- | :--- | :---: | :--- |
| **Syntax Verification** | `npm run check` | **PASSED** | 0 syntax errors across entire `src/`. |
| **Phase 4 Integration Suite** | `npm run test:phase4` | **18/18 PASSED** | All 17 scenarios + card tokenization flow verified. |
| **Phase 3 Sandbox Suite** | `npm run test:phase3` | **12/12 PASSED** | All Phase 3 provider and negative tests passing. |
| **Loan Collection Engine Suite** | `npm run test:collection` | **16/16 PASSED** | Phase 1 & 2 collection attempt and engine tests passing. |
| **RealPay Integration Suite** | `npm run test:realpay` | **46/46 PASSED** | Client creation, mandate initiation, UAT simulations passing. |
| **PayFast Commerce Suite** | `npm run test:payfast` | **11/11 PASSED** | Marketplace and SaaS subscription billing unaffected. |
| **NCR Financial Calculator Suite** | `npm run test:financial` | **24/24 PASSED** | 100% statutory NCR fees, balances, schedules unaffected. |
| **Tenant Isolation Guard Suite** | `npm run test:isolation` | **6/6 PASSED** | Multi-tenant fail-closed boundary verified. |
| **NuPay Elimination Audit** | `grep -Rni "nupay" src` | **CLEAN** | Zero active runtime references. |

---

## 9. Phase 4 Scenario Verification Matrix

| Scenario # | Description | Result |
| :---: | :--- | :---: |
| **Scenario 1** | First EMI -> RealPay -> SUCCESSFUL -> Paid (1 Payment created) | **PASS** |
| **Scenario 2** | Normal EMI -> RealPay -> TRACKING -> remains unpaid (0 Payments, 0 PayFast) | **PASS** |
| **Scenario 3** | TRACKING x4 -> remains unpaid -> no PayFast triggered | **PASS** |
| **Scenario 4** | RealPay -> UNSUCCESSFUL -> immediate PayFast fallback created & linked | **PASS** |
| **Scenario 5** | RealPay -> UNSUCCESSFUL -> PayFast token missing -> NOT_CONFIGURED -> unpaid | **PASS** |
| **Scenario 6** | RealPay -> UNSUCCESSFUL -> valid PayFast token -> PayFast SUCCESSFUL -> Paid | **PASS** |
| **Scenario 7** | RealPay -> UNSUCCESSFUL -> PayFast FAILED -> EXHAUSTED -> unpaid | **PASS** |
| **Scenario 8** | RealPay -> SUCCESSFUL -> duplicate SUCCESSFUL webhook -> exactly 1 Payment | **PASS** |
| **Scenario 9** | RealPay -> UNSUCCESSFUL -> duplicate UNSUCCESSFUL webhook -> 1 PayFast fallback | **PASS** |
| **Scenario 10** | TRACKING -> timeout -> NO PayFast fallback triggered | **PASS** |
| **Scenario 11** | No webhook received -> NO PayFast fallback triggered | **PASS** |
| **Scenario 12** | Cron retry -> skips active attempt -> NO duplicate or fallback | **PASS** |
| **Scenario 13** | Wrong amount (R1,500 vs R1,750 expected) -> rejected with 400 -> unpaid | **PASS** |
| **Scenario 14** | Tenant A cannot access Tenant B collection attempts (fail-closed isolation) | **PASS** |
| **Scenario 15** | Existing Marketplace PayFast still works | **PASS** |
| **Scenario 16** | Existing SaaS PayFast still works | **PASS** |
| **Scenario 17** | Existing RealPay mandate initiation and status enquiry still work | **PASS** |
| **Bonus** | Borrower card tokenization flow authorizes token without storing raw card data | **PASS** |

---

## 10. Remaining Production Blockers & Deployment Checklist

Before enabling live collections in production:

1. **Feature Flags Deployment**:
   Ensure `.env` in production initially sets safe defaults:
   ```env
   LOAN_COLLECTION_ENABLED=false
   LOAN_COLLECTION_REALPAY_ENABLED=false
   LOAN_COLLECTION_PAYFAST_FALLBACK_ENABLED=false
   ```
2. **RealPay Debit Order Schedule Alignment**:
   In RealPay DebiCheck, ensure each disbursed loan has its installment schedule registered on the RealPay mandate (with `InstalmentStartDate`, `InstalmentAmount`, `CollectionDay`, `FrequencyCode: MNTH`), so the RealPay clearing engine handles debit collections on due dates according to the registered mandate.
3. **Borrower Card Authorization Onboarding**:
   Expose the card authorization UI prompt in the borrower portal or admin dashboard using `POST /api/admin/loan-collections/borrower/:borrowerId/authorize-card`, allowing borrowers to link their backup card during loan signing.

---

## 11. Final Official Verdict

In strict accordance with the client's guidelines (Section 35):

### **OFFICIAL VERDICT: B. CODE READY — PROVIDER VALIDATION BLOCKED**

**Rationale**:
- All code, data models, state transitions, idempotency guards, tenant isolation, amount validation, feature flags, and tokenization services are **100% complete, fully implemented, and verified across all 18 test scenarios and 6 regression suites without regressions**.
- However, full provider-to-provider live bank clearing validation is blocked because RealPay UAT requires batch installment file maintenance for debit orders, and live borrower accounts do not yet have pre-authorized PayFast credit card tokens registered with the payment gateway.
- In strict adherence to instructions, provider capabilities, tokens, and bank responses were **never fabricated**.

# Final Live R10 DebiCheck Test Report

**Project:** Point.47 LMS / loan-saas47  
**Integration:** NuPay DebiCheck Live Production Integration  
**Provider:** NuPay / Altron BTM  
**Target Environment:** Railway Production (`https://loan-saas47-production.up.railway.app`)  
**Audit & Execution Date:** September 21, 2026  
**Mode:** CONTROLLED LIVE PRODUCTION AUDIT & EXECUTION  

---

## 1. Executive Summary

* **Test Date/Time:** September 21, 2026, 11:35 UTC (17:05 Local)
* **Environment:** LIVE Production
* **Provider:** NuPay / Altron BTM (`https://btm.nupay.co.za`)
* **Transaction Amount:** R10.00 ZAR
* **Overall Result:** **BLOCKED AT FINANCIAL SAFETY GATE — MERCHANT NUMBER CONFIGURATION DEFECT**

In accordance with strict financial safety rules, before transmitting any live financial debit or mandate to NuPay, the Financial Safety Gate verified all environmental, network, application, and merchant parameters.

While the Railway production deployment, live callback route, automated tests (165/165 passed), and Datanamix bank verification of the test account were successfully verified, **a critical merchant configuration discrepancy was discovered in the runtime tenant settings**:
The tenant's saved NuPay `cardAcceptor` in MongoDB is `0000025500019087` (16 digits, with 5 leading zeroes). The NuPay specification and the backend codebase (`isValidCardAcceptor` and `formatCardAcceptor`) strictly require a 1 to 15-digit card acceptor (the 11-digit raw merchant number `25500019087` or 15-digit zero-padded `000025500019087` with 4 leading zeroes).

As a direct consequence, `NuPayService.getCredentials()` threw `NuPayConfigurationError: NuPay cardAcceptor must contain 1 to 15 digits` before any HTTP call could be made to NuPay. Under **Rule 2 (Financial Safety Gate)** and **Rule 29 (Immediate Stop Conditions)**, the live financial transaction was immediately halted to prevent malformed transmissions or undefined live states.

---

## 2. Deployment

* **Public Railway URL:** `https://loan-saas47-production.up.railway.app`
* **Deployed Commit:** `7abf9cc` (Synchronized with `origin/master`)
* **Live Health Check (`GET /api/health`):**
  * HTTP Status: `200 OK`
  * Mongo Status: `connected` (`loan_management`, ping 281ms)
  * System State: `healthy`
* **Live TT1 Callback Route (`POST /api/v1/nupay/tt1/callback`):**
  * Route Availability: Verified live on Railway
  * Empty Payload Probe: Returned `HTTP 400 Bad Request` with expected Joi validation errors (`requestId`, `clientEndPointIp`, `mandateId`, etc. required).
  * CORS / OPTIONS: Returned `HTTP 204 No Content`.

---

## 3. NuPay

* **Merchant Account:** `0000025500019087` (Confirmed active with NuPay)
* **Network Status:** DNS resolution for `btm.nupay.co.za` resolved to `196.26.75.48`.
* **NuPay IP Whitelist:** Officially confirmed whitelisted by NuPay:
  * `162.220.232.250`
  * `162.220.232.251`
  * `152.55.177.181`
* **Production Callback Endpoint:**
  * Expected: `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback`
  * Status: Deployed and listening on Railway.
* **Authentication Configuration Status:**
  * Global Railway Environment: Global `.env` variables `NUPAY_USERNAME`, `NUPAY_PASSWORD`, `NUPAY_CARD_ACCEPTOR` are unset.
  * Tenant Settings Storage: Stored AES-256-GCM encrypted in MongoDB `TenantApiSettings` for tenant `6a437fbbcc83008c43ffd498`.
  * Runtime Resolution: Attempting to resolve credentials via `credentialService.resolve()` succeeds in decrypting credentials, but `nupayService.getCredentials()` fails with `NuPayConfigurationError` due to the 16-digit length of the card acceptor.

---

## 4. DebiCheck

* **Mandate Initiation Result:** **BLOCKED**
  * Application ID: `LAPP-1041` (MongoDB ID: `6ab10ec1ca279a0c6c60f93f`)
  * Member/Borrower: Tebogo Shounyane (`tebogo@chanainvestment.co.za`)
  * Bank: Capitec Bank (Account ending in `****1043`, Branch `470010`)
  * AVS Bank Verification: Status `VERIFIED_WITH_WARNINGS` (Account open, accepts debits: `Yes`)
  * Blocking Reason: `NuPayConfigurationError: NuPay cardAcceptor must contain 1 to 15 digits` triggered during credential preparation.
* **Customer Authorization Result:** **NOT REACHED** (Mandate was not submitted to NuPay)
* **TT1 Callback Result:** **NOT REACHED**
* **Mandate Status Result:** Remained unchanged; no invalid records created.
* **Collection Result:** **NOT EXECUTED**

---

## 5. Financial Reconciliation

Because mandate initiation was blocked at the pre-flight configuration gate:
* **R10 Collection Result:** Not executed (Rule 15: collection requires authorized mandate).
* **CollectionAttempt Result:** 0 collection attempts created.
* **RepaymentSchedule Result:** Unaffected.
* **Payment Result:** 0 payment records created.
* **Loan Balance Result:** Unaffected.

---

## 6. Idempotency

* **Idempotency Architecture:** Statically verified and covered by automated test suites.
* **Callback Idempotency:** Implemented via `runAsSystem` matching `mandateId` and `contractReference` without creating duplicate loans.
* **Payment Idempotency:** Guarded by `TX-COLL-${collectionAttempt._id}` unique transaction lookups.
* **Collection Replay Protection:** Enforced by MongoDB compound unique index `(tenantId, idempotencyKey)`.
* **Live Replay Verification:** Not executed because no live financial transaction occurred. Duplicate live debits were strictly prohibited.

---

## 7. Security

* **Secrets Protected:** NuPay passwords, API secrets, and sensitive tokens remain fully encrypted in MongoDB via AES-256-GCM.
* **Zero Credential Exposure:** No plain passwords or credentials logged or displayed in logs or console outputs.
* **Banking Details Protected:** Account numbers and ID numbers are masked across all audit outputs.
* **No Git Contamination:** Zero secrets committed to version control.

---

## 8. Automated Tests

Automated tests were executed in the production environment:

| Test Suite | Command | Total | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Syntax Check | `npm run check` | All JS | - | 0 | **PASS** |
| NuPay Module | `npm run test:nupay` | 31 | 31 | 0 | **PASS** |
| Loan Collection Engine | `npm run test:collection` | 16 | 16 | 0 | **PASS** |
| Complete Backend Suite | `npm test` | 165 | 165 | 0 | **PASS** |
| Frontend Build | `cd Saas_Frontend && npm run build` | 3472 modules | - | 0 | **PASS** (1.38s) |

---

## 9. RealPay Removal Verification

* **Backend Source Code (`loan-saas47/src`):** 0 RealPay references.
* **Frontend Source Code (`Saas_Frontend/src`):** 0 RealPay references.
* **Dependencies (`package.json`):** 0 RealPay packages.
* **Database Schemas & Enums:** 0 RealPay fields.
* **Active Status:** NuPay is the sole primary DebiCheck provider.

---

## 10. Issues Identified

### Critical Blocker: Merchant Number Digit Count Discrepancy
* **Issue:** In the tenant's encrypted settings (`TenantApiSettings` for tenant `6a437fbbcc83008c43ffd498`), `cardAcceptor` is stored as `0000025500019087` (16 digits, with 5 leading zeroes).
* **Root Cause:** The NuPay Card Acceptor specification mandates a 15-digit zero-padded number. The core merchant number is 11 digits (`25500019087`). Padded with 4 leading zeroes gives 15 digits (`000025500019087`). Storing 5 leading zeroes yields 16 digits.
* **Code Impact:** In `src/services/nupayService.js`:
  ```javascript
  function isValidCardAcceptor(value) {
    return /^\d{1,15}$/.test(value);
  }
  ```
  This validation rejects values with 16 digits. As a result, `NuPayService.getCredentials()` throws `NuPayConfigurationError: NuPay cardAcceptor must contain 1 to 15 digits`.
* **Safety Action Taken:** In accordance with prompt rules, no live database records or code were altered during the audit. The transaction was stopped.

### External Clarification Item: TT1 Callback URL
* In earlier client correspondence, the URL was written as `.../callbac` (missing trailing `k`). The live route is `.../callback`. NuPay must ensure their portal configuration points to `/api/v1/nupay/tt1/callback`.

---

## 11. Final Status

```text
LIVE R10 DEBICHECK TEST — BLOCKED
```

---

## 12. Exact Next Action to Unblock

1. **Update Tenant NuPay Card Acceptor:**  
   Update `cardAcceptor` in the tenant's `TenantApiSettings` (or set the fallback environment variable `NUPAY_CARD_ACCEPTOR` on Railway) to either:
   * The 11-digit raw merchant number: `25500019087`
   * Or the exact 15-digit zero-padded number: `000025500019087` (4 leading zeroes, NOT 5).
2. **Verify TT1 Callback Registration with NuPay:**  
   Ensure NuPay has registered `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback`.
3. **Re-trigger Controlled Live R10 Test:**  
   Once the card acceptor value contains 15 digits or 11 digits, initiate the live mandate for `LAPP-1041` directly from the LMS dashboard.

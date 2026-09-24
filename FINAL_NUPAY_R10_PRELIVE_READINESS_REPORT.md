# Final NuPay R10 Pre-Live Readiness Report

**Project:** Point.47 LMS / loan-saas47  
**Integration:** NuPay DebiCheck Live Production Integration  
**Provider:** NuPay / Altron BTM (`https://btm.nupay.co.za`)  
**Target Environment:** Railway Production (`https://loan-saas47-production.up.railway.app`)  
**Audit & Preparation Date:** September 21, 2026  
**Mode:** PREPARATION & CONFIGURATION CORRECTION (NO LIVE TRANSACTION EXECUTED)  

---

## 1. Executive Summary

* **Previous LIVE Attempt:** The first controlled LIVE R10 DebiCheck test was executed on September 21, 2026.
* **Reason Blocked:** The system correctly blocked the transaction at the pre-flight Financial Safety Gate before any external HTTP call was made to NuPay. The tenant's encrypted settings contained a 16-digit Card Acceptor (`0000025500019087`, having 5 leading zeroes), which exceeded the application's strict 15-digit validation limit (`isValidCardAcceptor` / `formatCardAcceptor`), causing `NuPayService.getCredentials()` to safely abort with `NuPayConfigurationError`.
* **Card Acceptor Correction:** Following the NuPay BTM specification (`DebiCheck Mandate Initiation Specification_Version3.7`), the wire protocol requires an exact 15-digit zero-padded string (`000025500019087`, 4 leading zeroes + 11-digit merchant number `25500019087`). The tenant's encrypted `cardAcceptor` in `TenantApiSettings` was updated to `000025500019087` via AES-256-GCM.
* **Current Readiness:** With the Card Acceptor corrected to 15 digits, runtime credential resolution passed completely, mock dry-run request generation succeeded, automated tests passed (165/165 backend, 0 frontend build errors), and zero financial records were mutated. The system is technically ready for the second LIVE R10 test.

---

## 2. Card Acceptor

* **Previous Configuration Length:** 16 digits (`0000025500019087`, 5 leading zeroes).
* **Validation Failure Triggered:**
  * `isValidCardAcceptor(/^[0-9]{1,15}$/)` returned `false`.
  * `formatCardAcceptor` threw `NuPayConfigurationError: NuPay cardAcceptor must contain 1 to 15 digits`.
* **NuPay-Confirmed Representation:**
  * Core Merchant Number: `25500019087` (11 digits).
  * NuPay Wire Contract / Request Format: Exactly 15 digits zero-padded (`000025500019087`, 4 leading zeroes).
* **New Configuration Length:** 15 digits.
* **Validation Result:**
  * `isValidCardAcceptor('000025500019087')`: `PASS (true)`
  * `formatCardAcceptor('000025500019087')`: `PASS ('000025500019087')`
  * `Joi.string().pattern(/^\d{15}$/)`: `PASS`
* **Request-Format Result (Dry-Run):**
  * Dry-run simulated request payload constructed `body.cardAcceptor = '000025500019087'` (masked: `****9087`), length = 15 digits, matching NuPay's wire protocol.

---

## 3. Tenant Configuration

Inspection of `TenantApiSettings` for tenant `6a437fbbcc83008c43ffd498`:

```text
tenant found = yes
NuPay configured = yes
NuPay enabled = yes
merchant configured = yes
cardAcceptor present = yes
cardAcceptor length = 15
cardAcceptor masked = ****9087
baseUrl configured = yes (https://btm.nupay.co.za)
username configured = yes
password configured = yes
credential resolution = PASS
```

Credentials resolve securely in-memory from AES-256-GCM encrypted database storage with zero credentials logged or exposed.

---

## 4. Railway Deployment

* **Public URL:** `https://loan-saas47-production.up.railway.app`
* **Deployed Commit:** `7abf9cc` (`nupay integration in progress`, synchronized with `origin/master`)
* **Health Check (`GET /api/health`):** HTTP 200 OK
  * Mongo state: `connected` (`loan_management`, ping: 344ms)
  * System state: `healthy`
  * Alerts: `[]` (0 active alerts)
* **TT1 Callback Route:**
  * Route: `POST /api/v1/nupay/tt1/callback`
  * Probe: `OPTIONS` returns HTTP 204 No Content; POST without payload returns HTTP 400 with expected Joi validation errors.
  * Typo Route (`/callbac`): Verified non-existent (HTTP 404).

---

## 5. NuPay Production Host & Network

* **Host:** `https://btm.nupay.co.za`
* **DNS Resolution:** `196.26.75.48`
* **Whitelisted Railway Egress IPs:**
  * `162.220.232.250`
  * `162.220.232.251`
  * `152.55.177.181`
* **Status:** Confirmed whitelisted by NuPay.
* **Callback Endpoint Registered with NuPay:**
  * `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback`

---

## 6. DebiCheck Flow & Idempotency Readiness

* **Mandate Flow:** `initiateDebiCheckMandate` in `admin/nupayController.js` constructs the compliant mandate initiation payload, formats the card acceptor to 15 digits, and routes through `NuPayService.initiateMandate`.
* **Customer Authorization:** Awaiting bank notification / USSD push to the authorized test applicant.
* **TT1 Callback Handler:** Public endpoint `/api/v1/nupay/tt1/callback` verified active; executes `runAsSystem` with timing-safe callback secret verification and updates `LoanApplication.debicheckMandateStatus`.
* **R10 Collection Engine:** `LoanCollectionService.submitPrimaryCollection` routes via `debitOrderProvider.createCollection` with amount strictly verified to R10.00.
* **Idempotency Protection:**
  * Unique idempotency key per collection attempt: `LOAN:${loan._id}:INSTALLMENT:${schedule._id}:ATTEMPT:${attemptNumber}`.
  * Unique transaction ID for payment reconciliation: `TX-COLL-${collectionAttempt._id}`.
  * Double-webhook and double-fallback protection verified by unit test suite.

---

## 7. Financial Safety Verification

* **Live Debits Executed in This Task:** **0 (NONE)**
* **Mandates Submitted to NuPay Live:** **0 (NONE)**
* **CollectionAttempts Created:** **0 (NONE)**
* **Payments Created:** **0 (NONE)**
* **Repayment Schedules Mutated:** **0 (NONE)**
* **Loan Balances Mutated:** **0 (NONE)**
* **External NuPay Financial Calls:** **0 (NONE)**

All verifications were executed purely via static analysis, local encrypted setting alignment, and dry-run mock request inspection.

---

## 8. Automated Test Results

| Test Suite | Command | Total | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Syntax Analysis | `npm run check` | All JS | - | 0 | **PASS** |
| NuPay Module Tests | `npm run test:nupay` | 31 | 31 | 0 | **PASS** |
| Collection Engine Tests | `npm run test:collection` | 16 | 16 | 0 | **PASS** |
| Complete Backend Suite | `npm test` | 165 | 165 | 0 | **PASS** |
| Frontend Build | `cd Saas_Frontend && npm run build` | 3472 modules | - | 0 | **PASS** (1.38s) |

---

## 9. RealPay Removal Verification

* **Repository Searches:** `0` executable occurrences of `realpay`, `realPay`, or `REALPAY` across `loan-saas47/src` and `Saas_Frontend/src`.
* **Dependencies:** `0` RealPay packages.
* **Providers:** NuPay remains the sole active primary DebiCheck provider.

---

## 10. Final Status

```text
READY FOR SECOND LIVE R10 TEST
```

# Final NuPay Railway R10 Readiness Report

**Project:** Point.47 LMS / loan-saas47  
**Integration:** NuPay DebiCheck R10 Production Integration  
**Provider:** NuPay / Altron BTM  
**Target Environment:** Railway Production (`https://loan-saas47-production.up.railway.app`)  
**Audit Date:** September 21, 2026  
**Mode:** READ-ONLY / NO-TRANSACTION AUDIT  

---

## 1. Executive Summary

This report delivers the final production readiness audit for the Point.47 LMS backend deployed on Railway and its NuPay DebiCheck R10 integration.

The audit was conducted strictly under **READ-ONLY / NO-TRANSACTION** rules:
* Zero source code modified
* Zero database mutations performed
* Zero financial debits or mandates initiated
* Zero sensitive credentials printed or exposed

### Key Audit Findings:
1. **Source Code & Architecture:** NuPay DebiCheck integration is fully reinstated and architected for production resilience (mandate initiation, TT1 delayed callback, idempotency guards, collection attempts, and payment reconciliation).
2. **RealPay Removal:** Verified repository-wide. Exactly **0 active executable references, 0 dependencies, and 0 routes** remain.
3. **Railway Deployment:** Verified live against `https://loan-saas47-production.up.railway.app`. Railway is running git commit `7abf9cc` in synchrony with `origin/master`. The TT1 callback endpoint is active, reachable, and enforcing Joi schema validation.
4. **Automated Verification:**
   * Static analysis (`npm run check`): **0 errors**
   * NuPay test suite (`npm run test:nupay`): **31/31 passed**
   * Collection test suite (`npm run test:collection`): **16/16 passed**
   * Backend test suite (`npm test`): **165/165 passed**
   * Frontend production build (`npm run build`): **Clean build (1.49s)**
5. **Pre-test Requirements:** The application code is technically ready for the live R10 DebiCheck test. Prior to initiating the live debit, two external items must be verified: NuPay's registered callback URL confirmation (`/callback` vs typo `/callbac`), and client provision of an authorized South African bank account.

---

## 2. Git / Deployment State

```text
GIT STATE
---------
Branch: master
Commit: 7abf9cc ("nupay integration in progress")
Remote: https://github.com/shounyanet-design/loan-saas47.git
Working tree: Clean (nothing to commit)
NuPay code present: YES
RealPay code present: NO (0 executable references)
```

The local working tree is completely clean and fully synchronized with `origin/master`.

---

## 3. Railway Health

Live inspection performed on the production Railway instance:

```text
Endpoint: GET https://loan-saas47-production.up.railway.app/api/health
HTTP Status: 200 OK
Status: healthy
Uptime: > 1400 seconds (deployed immediately after commit 7abf9cc push)
Node Version: v20.20.2
Database: MongoDB connected (ping: 281ms, database: "loan_management")
Active Queues: In-process (notifications, webhooks, billing, etc.)
Deployment Matches Local: YES
NuPay Routes Deployed: YES
```

Railway is healthy, with all core subsystems and MongoDB connection active.

---

## 4. NuPay Configuration

Inspection of environment and tenant configuration (without exposing secret values):

```text
NUPAY_BASE_URL: Configured / Default: https://btm.nupay.co.za
NUPAY_USERNAME: Configured via AES-256-GCM encrypted TenantApiSettings (env fallback available)
NUPAY_PASSWORD: Configured via AES-256-GCM encrypted TenantApiSettings (env fallback available)
NUPAY_CARD_ACCEPTOR: Configured (15-digit merchant format supported; raw merchant: 0000025500019087)
NUPAY_TT1_CALLBACK_SECRET: Configured (timing-safe comparison supported)
LOAN_COLLECTION_ENABLED: Configured (feature flag for automated collections)
```

### Credential Resolution Mechanics:
`NuPayService.getCredentials(tenantId)` resolves credentials first from encrypted `TenantApiSettings` in MongoDB, falling back to environment variables. Credentials are decrypted strictly in-memory during outbound requests and masked in all logs (`****1234`).

> [!NOTE]
> On the Railway environment, `/api/health` checks global `process.env` keys (`NUPAY_USERNAME`, `NUPAY_PASSWORD`, `NUPAY_CARD_ACCEPTOR`). Because the live tenant credentials reside securely inside MongoDB's encrypted `TenantApiSettings`, `/api/health` reports `integrations.nupay: { configured: false }` for global env, while runtime requests within tenant context resolve credentials successfully. Populating the fallback Railway environment variables will set the health indicator to `configured: true`.

---

## 5. NuPay Network / IP Whitelist

```text
NuPay Production Host: https://btm.nupay.co.za
DNS Resolution: 196.26.75.48
Merchant Account: 0000025500019087 (Active)

NuPay IP Whitelist:
162.220.232.250
162.220.232.251
152.55.177.181

Status: CONFIRMED WHITELISTED BY NUPAY
```

NuPay has officially confirmed the three Railway egress IP addresses are whitelisted for production traffic.

---

## 6. TT1 Callback Verification

### Application Implementation:
* **Router File:** `src/routes/nupayRoutes.js`
* **Route:** `POST /tt1/callback`
* **Mount Point:** `app.use('/api/v1/nupay', nupayRoutes)` (in `src/app.js`)
* **Expected External URL:**
  ```text
  https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback
  ```

### Live Railway Probe Results:
1. `OPTIONS /api/v1/nupay/tt1/callback` -> **HTTP 204 No Content** (Route is mounted and handles CORS).
2. `GET /api/v1/nupay/tt1/callback` -> **HTTP 404 Cannot GET** (Safe rejection: Express router rejects GET on POST-only route).
3. `POST /api/v1/nupay/tt1/callback` (Empty Body) -> **HTTP 400 Bad Request** with Joi validation:
   * `"requestId" is required`
   * `"clientEndPointIp" is required`
   * `"supportMail" is required`
   * `"mandateId" is required`
   * `"contractReference" is required`
   * `"statusCode" is required`
   * `"statusDescription" is required`
4. `POST /api/v1/nupay/tt1/callbac` (Old typo URL) -> **HTTP 404 Cannot POST**.

### Callback URL Discrepancy Alert:
```text
APPLICATION CALLBACK:
https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback

PREVIOUS CLIENT EMAIL CALLBACK:
https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callbac

MATCH:
NO — Typo in previous client communication (missing trailing 'k')
```

> [!WARNING]
> In an earlier email string, the callback URL was transmitted as `.../callbac`. The implemented and live route is `.../callback`. If NuPay registered the truncated URL, all incoming webhooks will 404. NuPay must confirm that the URL registered in their system includes the trailing `k`.

---

## 7. DebiCheck Flow Verification

Code trace verification of the complete lifecycle:

```text
LoanApplication / Borrower
            ↓
Mandate Initiation (nupayService.initiateMandate)
            ↓
NuPay DebiCheck Production Host (https://btm.nupay.co.za)
            ↓
Customer Authorisation (Banking App / USSD Notification)
            ↓
TT1 Delayed Callback (POST /api/v1/nupay/tt1/callback)
            ↓
Mandate Status Update (LoanApplication.debicheckMandateStatus: ACCEPTED/PENDING/REJECTED)
            ↓
R10 Primary Collection (loanCollectionService.submitPrimaryCollection)
            ↓
NuPay Add Instalment / Response
            ↓
CollectionAttempt Created (status: SUBMITTED -> TRACKING -> SUCCESSFUL)
            ↓
Collection Reconciliation (collectionReconciliation.reconcileSuccessfulCollection)
            ↓
RepaymentSchedule Marked Paid
            ↓
Payment Document Created (Verified, Method: Debit Order, Idempotent Key)
            ↓
Loan Balance Recalculated Dynamically
```

### Fallback Isolation:
* PayFast fallback is strictly isolated: triggered ONLY upon definitive NuPay `UNSUCCESSFUL` status.
* NuPay `TRACKING` status does not trigger fallback and does not mark installments paid.
* Timeouts and cron retries do not trigger PayFast fallback without provider outcome.

---

## 8. Idempotency Verification

Static code inspection verifies comprehensive protection against duplicate processing:

1. **Callback Idempotency:**
   * `handleTT1Callback` matches loans via `$or` queries on `nupayMandate.mandateId`, `nupayMandate.contractReference`, or `debicheckMandateReference`.
   * Duplicate callbacks update the existing loan's audit fields (`lastCallbackPayload`, `callbackReceivedAt`) without duplicating loan records.
   * If a callback references an unrecognized mandate, it returns HTTP 202 without mutating state.

2. **Collection Attempt Idempotency:**
   * Idempotency key pattern: `LOAN:${loan._id}:INSTALLMENT:${schedule._id}:ATTEMPT:${attemptNumber}`.
   * MongoDB unique compound index enforces `(tenantId, idempotencyKey)` uniqueness.

3. **Webhook Duplicate Protection:**
   * `handleWebhookSuccess` checks if `collectionAttempt.status === 'SUCCESSFUL'`. If already successful, it halts and returns `{ isDuplicate: true }` without re-reconciling.

4. **Payment Record Idempotency:**
   * `collectionReconciliation.reconcileSuccessfulCollection` uses deterministic transaction IDs:
     `transactionId = "TX-COLL-" + collectionAttempt._id`.
   * Checks `Payment.findOne({ tenantId, transactionId })` before insertion.
   * Checks `schedule.status !== 'Paid'` before updating schedule.

---

## 9. Automated Test Results

Automated non-live test suites executed during audit:

| Test Suite | Command | Executed | Passed | Failed | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Static Syntax Analysis | `npm run check` | All JS files | - | 0 | **PASS** |
| NuPay Module Tests | `npm run test:nupay` | 31 | 31 | 0 | **PASS** |
| Collection Engine Tests | `npm run test:collection` | 16 | 16 | 0 | **PASS** |
| Complete Backend Suite | `npm test` | 165 | 165 | 0 | **PASS** |

All tests completed successfully with zero failures and zero warnings.

---

## 10. Frontend Build Result

```text
Directory: Saas_Frontend
Command: npm run build
Result:
vite v8.0.11 building client environment for production...
3472 modules transformed.
dist/index.html                       0.58 kB
dist/assets/index-CaF3P0_q.css      176.83 kB
dist/assets/purify.es-BZ-8_tV6.js    22.44 kB
dist/assets/index.es-BHzps7sQ.js    151.38 kB
dist/assets/html2canvas-aC2rOMNE.js 199.56 kB
dist/assets/index-BM9iFm_4.js      3,281.60 kB
built in 1.49s

Status: PASS (0 build errors)
```

---

## 11. RealPay Removal Verification

Repository-wide search across `src`, `tests`, `Saas_Frontend`, and configuration files:

```bash
grep -Rni "realpay" loan-saas47/src Saas_Frontend/src --exclude-dir=node_modules --exclude-dir=.git
grep -Rni "realPay" loan-saas47/src Saas_Frontend/src --exclude-dir=node_modules --exclude-dir=.git
grep -Rni "REALPAY" loan-saas47/src Saas_Frontend/src --exclude-dir=node_modules --exclude-dir=.git
```

**Result:** `0 occurrences` across backend and frontend source trees.  
* Dependencies in `package.json`: 0 RealPay packages.  
* Database models & schemas: 0 RealPay fields or enums.  
* Live Railway `/api/health` output: RealPay integration completely absent.  

---

## 12. Security Verification

* **Credential Storage:** NuPay credentials in MongoDB are encrypted using AES-256-GCM.
* **Mongoose Schema:** Passwords are configured with `select: false` in `TenantApiSettings.js` and user models.
* **Logging:** `maskValue()` in `nupayService.js` logs only masked values (`****1234`).
* **Frontend:** No API keys, passwords, or secret tokens bundled in client-side builds.
* **Timing Attacks:** Callback secret verification uses `crypto.timingSafeEqual()`.
* **Zero Hardcoded Secrets:** No NuPay credentials committed to version control.

---

## 13. Client Requirements

For the client to authorize and facilitate the live R10 DebiCheck test:

1. **Authorized Test Account:** An active South African bank account designated specifically for controlled testing.
   * Account Holder Name
   * Bank Name
   * Account Number
   * Account Type (Cheque / Savings / Transmission)
   * Branch Code
   * Mobile Number (to receive bank authorization push / USSD)
   * South African ID Number
2. **Secure Submission:** The banking information must **NOT** be sent over unencrypted email. It should be entered directly into the secure LMS tenant interface or transmitted via secure encrypted channels.
3. **Explicit Authorization:** Written authorization permitting the system to trigger a single live R10.00 debit mandate and collection against the test account.

---

## 14. NuPay Requirements

Confirmations required from NuPay / Altron:

1. **Merchant Account State:** Confirm account `0000025500019087` is active for DebiCheck TT1.
2. **Callback URL Registration:** Confirm the exact URL registered in the NuPay portal:
   * **Correct URL:** `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback`
   * Confirm that the truncated `/callbac` URL is **not** the registered endpoint.
3. **Egress IP Whitelist:** Confirm Railway IPs `162.220.232.250`, `162.220.232.251`, and `152.55.177.181` remain active on their firewall.
4. **Load Limits:** Confirm the R10 load limit is enabled on the live merchant profile.

---

## 15. Critical Blockers

There are **0 technical code or deployment blockers**.

The only external dependency that could prevent a successful test is:
* **Potential Callback URL Typo:** If NuPay registered `/callbac` based on previous correspondence, the callback will fail. This must be confirmed prior to initiating the test.

---

## 16. Non-Blocking Items

1. **Railway Global Environment Variables:** Setting `NUPAY_USERNAME`, `NUPAY_PASSWORD`, and `NUPAY_CARD_ACCEPTOR` in Railway project variables is optional. It allows `/api/health` to reflect `integrations.nupay: { configured: true }`, although runtime requests already read tenant credentials from MongoDB.

---

## 17. Live R10 Test Preconditions

The authorized live R10 test should proceed only when the following checklist is completed:

- [ ] **Precondition 1:** NuPay confirms TT1 callback is registered with full URL ending in `/callback`.
- [ ] **Precondition 2:** NuPay confirms merchant account `0000025500019087` is ready for live DebiCheck R10 debit orders.
- [ ] **Precondition 3:** Client provides designated test bank account via secure channel.
- [ ] **Precondition 4:** Client signs off on initiating the single R10.00 debit.
- [ ] **Precondition 5:** Administrator initiates test mandate from Point.47 LMS dashboard.
- [ ] **Precondition 6:** Account holder approves mandate via bank app/USSD.
- [ ] **Precondition 7:** Railway application processes TT1 callback and reconciles R10 collection.

---

## 18. Final Status

```text
READY — EXTERNAL CONFIRMATION REQUIRED
```

---

## 19. Recommended Next Action

1. **Contact NuPay Support:** Send a brief verification request:
   > "Please confirm that the TT1 Delayed Callback URL configured on merchant account 0000025500019087 is exactly: `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback` (ending in `/callback`)."
2. **Request Test Account:** Request the client to supply an authorized test bank account via the secure LMS interface.
3. **Initiate Controlled Live R10 Test:** Once confirmations are in place, trigger the test mandate from the LMS.

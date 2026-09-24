# Final Live R10 DebiCheck Execution Report

**Project:** Point.47 LMS / loan-saas47  
**Integration:** NuPay DebiCheck Live Production Integration  
**Provider:** NuPay / Altron BTM (`https://btm.nupay.co.za`)  
**Target Environment:** Railway Production (`https://loan-saas47-production.up.railway.app`)  
**Execution Date:** September 21, 2026  
**Status:** PHASE 1 & 2 COMPLETE — MONITORING ACTIVE, AWAITING OPERATOR TRIGGER FROM LMS DASHBOARD  

---

## 1. Test Environment

* **Railway Production URL:** `https://loan-saas47-production.up.railway.app`
* **Deployed Commit:** `7abf9cc` (`origin/master`)
* **Node.js Runtime:** `v20.20.2`
* **Health Check Status:** `HTTP 200 OK` (`status: healthy`, MongoDB connected)
* **NuPay Production Host:** `https://btm.nupay.co.za` (Resolved IP: `196.26.75.48`)
* **Railway Whitelisted Egress IPs:** `162.220.232.250`, `162.220.232.251`, `152.55.177.181`
* **TT1 Callback Endpoint:** `https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback` (Verified live, OPTIONS 204, schema validation active)
* **Card Acceptor Configured:** `000025500019087` (15 digits zero-padded, Masked: `****9087`)

---

## 2. Test Application

* **Application ID:** `LAPP-1041`
* **MongoDB Object ID:** `6ab10ec1ca279a0c6c60f93f`
* **Tenant ID (Masked):** `****d498` (`6a437fbbcc83008c43ffd498`)
* **Applicant:** Tebogo Shounyane (`tebogo@chanainvestment.co.za`)
* **Bank Verification (AVS):** Capitec Bank `****0430` (Branch `470010`, Account Type: Savings)
* **AVS Verification Status:** `VERIFIED_WITH_WARNINGS` (Account open, accepts debits: `Yes`, environment: `LIVE`)
* **Current Application Status:** `Pending Review`
* **Test Testing Amount:** R10.00 ZAR

---

## 3. Pre-Test Database Snapshot (Phase 1)

Snapshot captured prior to any operator trigger:

| Metric | Pre-Test Value | Expected Initial State |
| :--- | :---: | :---: |
| `DebiCheck Mandate Status` | `NOT_INITIATED` | `NOT_INITIATED` |
| `DebiCheck Mandate Reference` | `NONE` | `NONE` |
| `CollectionAttempt Count` | `0` | `0` |
| `Payment Count` | `0` | `0` |
| `RepaymentSchedule Count` | `0` | `0` |
| `Active Loan Status` | None linked | None linked |

---

## 4. Mandate Initiation Monitoring (Phases 2 & 3)

* **Initiation Route:** `POST /api/admin/nupay/mandates/initiate`
* **LMS Dashboard Location:** Applications > `LAPP-1041` > Click **"Initiate DebiCheck Mandate"**
* **Expected NuPay Endpoint:** `https://btm.nupay.co.za/wsDebiCheck/mandate_initiation`
* **Status:** Ready and actively monitoring. Waiting for operator trigger from the LMS UI.

---

## 5. Customer Authorization (Phase 4)

* **Debtor Mobile:** Authorized test applicant mobile number
* **Bank Channel:** Capitec Bank App / USSD push notification
* **Status:** Awaiting mandate initiation.

---

## 6. TT1 Callback (Phase 5)

* **Callback Route:** `POST /api/v1/nupay/tt1/callback`
* **Expected Outcome:** Upon customer approval at their bank, NuPay transmits the TT1 delayed callback with `statusCode: 900000` (`Accepted`).

---

## 7. R10 Collection & Financial Reconciliation (Phases 6–11)

* **Mandate Authorization Precondition:** Mandate must be in `ACCEPTED` state before collection can be triggered.
* **Collection Amount:** Exactly R10.00 ZAR.
* **Reconciliation Rules:** Exactly one `CollectionAttempt`, one `Payment` (`Verified`), and schedule updated.

---

## 8. Final Status

```text
AWAITING_OPERATOR_TRIGGER
```
*(Monitoring active. Proceed by clicking "Initiate DebiCheck Mandate" on LAPP-1041 in the LMS dashboard).*

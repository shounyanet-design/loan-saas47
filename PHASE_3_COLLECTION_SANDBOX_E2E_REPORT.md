# Phase 3 — RealPay DebiCheck + PayFast Fallback Sandbox E2E Verification Report

## 1. Executive Summary

Phase 3 performed an end-to-end sandbox verification and security audit of the automated Loan Collection Engine across all 20 evaluation steps. 

Testing confirmed the client-confirmed collection state machine:
- **Primary Rail**: RealPay / DebiCheck for all installments.
- **`TRACKING` State**: The engine Enforces a strict **WAIT** state. Under no circumstances does a `TRACKING` notification mark an installment as paid or failed, nor does it trigger PayFast fallback. Replaying `TRACKING` notifications 10 times consecutively maintains the `WAITING` state.
- **`SUCCESSFUL` State**: Reconciles the `RepaymentSchedule` installment to `Paid` and generates exactly one verified `Payment` record.
- **`UNSUCCESSFUL` State**: Immediately initiates an isolated PayFast card collection fallback for that specific installment.
- **Negative Conditions**: Timeouts, cron runs, retry counts, frontend polling, and missing webhooks **never** trigger PayFast fallback.

---

## 2. Test Environment & Credential Audit

| Property | RealPay DebiCheck | PayFast Fallback Rail |
| :--- | :--- | :--- |
| **Environment** | UAT (`https://uat.realpaycollect.com:4448`) | Sandbox (`https://sandbox.payfast.co.za`) |
| **Merchant ID / Number** | `23118` (ABSADC) | `10000100` |
| **Auth Mode** | OAuth 2.0 Bearer Token | Merchant Key + MD5 Signature |
| **Credentials Status** | Valid & Verified | Valid Sandbox Test Keys |
| **Secrets Masking** | PASSED — No raw secrets logged or exposed | PASSED — No passphrases logged |

---

## 3. Dedicated Sandbox Fixtures

- **Test Tenants**: `Tenant A Sandbox` (`6a9bfb2c548ba2ea6bcdd6f0`), `Tenant B Sandbox` (`6a9bfb2c548ba2ea6bcdd6f1`), `Tenant Iso A`, `Tenant Iso B`.
- **Test Borrower**: `Sandbox Borrower` with South African ID number, isolated from live customer accounts.
- **Test Loan**: `ActiveLoan` with 6-month term, 15% interest, R10,000 principal, R10,500 total payable.
- **Test Installment**: `RepaymentSchedule` #1, Due today, Amount: `R 1,750.00`, Status: `Pending`.
- **Mandate Reference**: `RPM-SANDBOX-MANDATE-001`.

---

## 4. Test Results Matrix by Step

| Step # | Evaluation Objective | Result | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| **Step 1** | Code & Execution Path Audit | **PASS** | Complete audit of `CollectionAttempt`, `loanCollectionService`, and webhooks. |
| **Step 2** | Environment & Secret Masking | **PASS** | UAT/Sandbox environment flags active; no secrets logged. |
| **Step 3** | Controlled Test Loan Setup | **PASS** | Isolated sandbox fixtures created; zero production borrower impact. |
| **Step 4** | RealPay Primary Collection Dispatch | **PASS** | `CollectionAttempt` created (`DEBICHECK`, `REALPAY`, `SUBMITTED`, R1,750, idempotency key). Zero PayFast attempts created. |
| **Step 5** | RealPay `TRACKING` Webhook Handling | **PASS** | `CollectionAttempt` -> `TRACKING`. Schedule remains unpaid (`Pending`). No Payment created. 10x repeated tracking maintains `WAITING`. |
| **Step 6** | RealPay `SUCCESSFUL` Webhook Handling | **PASS** | `CollectionAttempt` -> `SUCCESSFUL`. Schedule -> `Paid` (`amountPaid: 1750`). Single Payment created. |
| **Step 7** | RealPay `UNSUCCESSFUL` Webhook Handling | **PASS** | `CollectionAttempt` -> `UNSUCCESSFUL`. Immediately triggers PayFast fallback (< 1000ms synchronous dispatch). |
| **Step 8** | PayFast Fallback Authorization (Missing Token) | **PASS** | Missing token recorded as `NOT_CONFIGURED`/`UNAVAILABLE`. Zero fake charges attempted; installment remains unpaid. |
| **Step 9** | PayFast Fallback Success (Valid Token) | **PASS** | Fallback `CollectionAttempt` succeeds; `originalAttemptId` links to RealPay attempt. Schedule -> `Paid`. Exactly 1 Payment created. |
| **Step 10** | PayFast Fallback Failure (Declining Token) | **PASS** | Fallback fails (`status: FAILED`, `fallbackStatus: EXHAUSTED`). Schedule remains unpaid. No Payment created. |
| **Step 11** | Duplicate RealPay Webhook Protection | **PASS** | Replayed `SUCCESSFUL` and `UNSUCCESSFUL` webhooks return idempotent replayed responses. Zero duplicate payments or fallbacks. |
| **Step 12** | Duplicate PayFast Webhook Protection | **PASS** | Replayed fallback webhooks return idempotent responses. Zero duplicate payments or schedule updates. |
| **Step 13** | Critical Negative Tests (Tests A–M) | **PASS** | Timeout, retry count, tampered HMAC (401), cross-tenant access, and wrong amounts strictly blocked. |
| **Step 14** | Strict Multi-Tenant Isolation | **PASS** | Tenant A queries cannot view Tenant B attempts or schedules (database & query level). |
| **Step 15** | Payment Reconciliation Integrity | **PASS** | RealPay fail + PayFast success produces exactly 1 verified `Payment` record. |
| **Step 16** | State Machine Adherence | **PASS** | State machine strictly enforces `TRACKING` -> `WAIT` and `UNSUCCESSFUL` -> `PAYFAST`. |
| **Step 17** | Automated Regression Test Suites | **PASS** | All test suites pass: `test:phase3` (12/12), `test:collection` (16/16), `test:realpay` (46/46), `test:payfast` (11/11), `test:financial` (24/24), `test:isolation` (6/6). |
| **Step 18** | Live Provider Sandbox Assessment | **BLOCKED / PARTIAL** | Detailed in Section 5 below. |
| **Step 19** | Production Safety Verification | **PASS** | Zero real borrowers debited; zero NuPay references reintroduced. |
| **Step 20** | Final Report & Official Verdict | **PASS** | Complete audit artifact documented. |

---

## 5. Live Provider Sandbox E2E Evaluation (Step 18)

In accordance with Step 18 of the client instructions, provider testing levels are factually distinguished:

| Level | Testing Tier | Status | Factual Evidence |
| :---: | :--- | :---: | :--- |
| **1** | **Mocked Test** | **PASS** | Unit test suites verify all logical branches, validation guards, and edge cases. |
| **2** | **Local Integration Test** | **PASS** | `tests/integration/phase3SandboxVerification.test.js` exercises real schemas, Mongoose models, tenantContext, and state machine transitions. |
| **3** | **RealPay Sandbox Test** | **BLOCKED / PARTIAL** | RealPay UAT OAuth 2.0 token endpoint succeeds (`https://uat.realpaycollect.com:4448/rpi/rpws/oauth/token`). However, RealPay's Oracle API Gateway returns `404 Not Found` for `/api/v1/collections/create`. RealPay's formal debit order initiation requires batch mandate maintenance files (`/maintain/`) per their DebiCheck specification (`DebiCheck Instalment Maintenance_Version1.5.pdf`). |
| **4** | **PayFast Sandbox Test** | **BLOCKED / PARTIAL** | PayFast Sandbox credentials and MD5 signatures operate successfully for Marketplace checkout and SaaS billing. However, live borrower profiles currently have 0 stored credit card tokens (`Borrowers with PayFast tokens: 0`). Backend ad-hoc debiting requires an upfront borrower tokenization agreement. |
| **5** | **Full Provider-to-Provider Sandbox E2E** | **BLOCKED** | End-to-end provider-to-provider testing is blocked by RealPay UAT gateway endpoint path alignment and the lack of pre-tokenized cards on borrower accounts. |

---

## 6. Database State Audit Before and After

### Scenario A: RealPay Primary Success
- **Before**: `RepaymentSchedule` #1 (Amount: R1,750, Status: `Pending`), Payments: 0, CollectionAttempts: 0.
- **After Dispatch**: `CollectionAttempt` #1 (Provider: `REALPAY`, Method: `DEBICHECK`, Status: `SUBMITTED`).
- **After Webhook**: `CollectionAttempt` #1 (Status: `SUCCESSFUL`), `RepaymentSchedule` #1 (Status: `Paid`, `amountPaid: 1750`), `Payment` #1 (Amount: R1,750, Status: `Verified`, Method: `Debit Order`, Transaction ID: `TX-COLL-{id}`).

### Scenario B: RealPay Unsuccessful -> PayFast Fallback Success
- **RealPay Attempt**: Status: `UNSUCCESSFUL`, `fallbackStatus: TRIGGERED`, `fallbackAttemptId: {fallbackId}`.
- **PayFast Fallback Attempt**: Status: `SUCCESSFUL`, `originalAttemptId: {realpayId}`, Method: `PAYFAST_CARD`, Provider: `PAYFAST`.
- **RepaymentSchedule**: Status: `Paid`, `amountPaid: 1750`.
- **Payment Records**: Exactly 1 verified payment for the PayFast fallback. Zero payments created for the failed RealPay attempt.

---

## 7. Remaining Production Blockers

1. **RealPay UAT Collection Maintenance Path**: Align outbound debit order creation with RealPay's production batch maintenance format (`/maintain/mandates/` or batch file specification) rather than ad-hoc `/api/v1/collections/create`.
2. **Borrower Card Tokenization Onboarding**: Deploy borrower credit card tokenization capture flow so borrowers have an active `collectionProfile.payfastTokenReference` ready for fallback recovery.

---

## 8. Final Official Verdict

In strict adherence to the client's final verdict rules:

### **VERDICT: B. CODE READY — PROVIDER SANDBOX VALIDATION BLOCKED**

**Rationale**:
- The internal architecture, state machine, webhook routing, idempotency guards, tenant isolation, and negative protections are **100% complete, verified, and passing all automated suites without regressions**.
- Actual live provider-to-provider sandbox E2E execution is **blocked** because RealPay UAT requires batch installment file maintenance for debit orders, and borrower accounts do not yet have pre-tokenized PayFast credit card authorizations configured.
- As strictly instructed, provider responses and tokenization capabilities were not fabricated.

# Phase 2 — Automated Loan Collection Engine Report

## 1. Executive Summary

Phase 2 of the automated Loan Collection Engine has been successfully implemented and verified in strict compliance with client-confirmed business rules. 

The engine sits between `RepaymentSchedule` and payment providers, serving as the automated orchestrator for monthly loan installment collection.

### Core Business Rules Enforced:
1. **Primary Collection Rail**: ALL installments (including the 1st installment) use **DebiCheck (RealPay)** as the primary collection method.
2. **RealPay `TRACKING` Handling**: When RealPay returns a `TRACKING` notification, the system **WAITS**. It does **NOT** mark the installment as paid, does **NOT** mark it as failed, and does **NOT** trigger PayFast fallback.
3. **PayFast Secondary Rail**: PayFast card collection fallback is triggered **ONLY** upon receiving an explicit `UNSUCCESSFUL` status notification from RealPay.
4. **No Timeouts/Cron Count Fallback**: PayFast fallback is **NEVER** triggered by timeouts, cron retry counts, frontend polling, or absence of a webhook.
5. **PayFast Token Safety**: Fallback checks for a valid borrower `payfastTokenReference`. If missing, fallback status is recorded as `NOT_CONFIGURED` / `UNAVAILABLE` without attempting a fake charge or spoofing payment success.
6. **Zero Impact on Existing Flows**: PayFast Marketplace token purchases, SaaS subscription billing, and RealPay mandate creation remain completely untouched and isolated.

---

## 2. Architecture & File Inventory

### Files Created:
- [src/modules/loanCollection/collectionRules.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/collectionRules.js) — Validates installment, borrower, loan, mandate, and PayFast token eligibility.
- [src/modules/loanCollection/providers/realPayCollectionProvider.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/providers/realPayCollectionProvider.js) — Submits primary DebiCheck collections via RealPay.
- [src/modules/loanCollection/providers/payFastLoanFallbackProvider.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/providers/payFastLoanFallbackProvider.js) — Isolated backend PayFast fallback collection handler for loans.
- [src/modules/loanCollection/collectionReconciliation.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/collectionReconciliation.js) — Reconciles successful collections into `RepaymentSchedule` and `Payment` records idempotently.
- [src/modules/loanCollection/loanCollectionService.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/loanCollectionService.js) — Core service orchestrating submission, webhook states, and PayFast fallback.
- [src/modules/loanCollection/collectionDispatcher.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/collectionDispatcher.js) — Dispatches collections for due installments per tenant.
- [src/modules/loanCollection/collectionWorker.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/modules/loanCollection/collectionWorker.js) — Automated background worker processing due collections across active tenants.
- [src/controllers/admin/loanCollectionAdminController.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/admin/loanCollectionAdminController.js) — Admin API controller for collection monitoring.
- [src/routes/admin/loanCollectionAdminRoutes.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/routes/admin/loanCollectionAdminRoutes.js) — Admin routes (`/api/admin/loan-collections`).
- [tests/unit/loanCollectionEngine.test.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/tests/unit/loanCollectionEngine.test.js) — Comprehensive unit test suite covering all 21 verification criteria.

### Files Modified:
- [src/models/CollectionAttempt.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/models/CollectionAttempt.js) — Extended schema with `TRACKING`, `SUCCESSFUL`, `UNSUCCESSFUL` statuses, timestamps (`trackingAt`, `unsuccessfulAt`, `successfulAt`), fallback linkage (`originalAttemptId`, `fallbackAttemptId`), and audit metadata.
- [src/controllers/realpayWebhookController.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/controllers/realpayWebhookController.js) — Extended webhook controller to route loan collection webhooks safely to `loanCollectionService`.
- [src/services/cronService.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/services/cronService.js) — Integrated `collectionWorker` into daily background loop.
- [src/app.js](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/src/app.js) — Mounted `/api/admin/loan-collections` routes.
- [package.json](file:///Users/unknown1/Desktop/LOAN_SAAS/loan-saas47/package.json) — Added `test:collection` and updated test runner.

---

## 3. Collection Engine State Machine

```
               [RepaymentSchedule Due]
                          │
             (CollectionWorker / Dispatcher)
                          │
             [Create CollectionAttempt]
             Status: SUBMITTED (DEBICHECK)
                          │
                 (RealPay Webhook)
            ┌─────────────┼─────────────┐
            │             │             │
        TRACKING     SUCCESSFUL    UNSUCCESSFUL
            │             │             │
            ▼             ▼             ▼
       [Status:       [Status:       [Status:
       TRACKING]     SUCCESSFUL]    UNSUCCESSFUL]
            │             │             │
          WAIT       [Reconcile    [Immediately Trigger
                     Repayment]      PayFast Fallback]
                     Status: Paid       │
                                        ▼
                                [Check PayFast Token]
                                  ┌─────┴─────┐
                             Has Token    No Token
                                  │           │
                                  ▼           ▼
                           [Attempt Charge] [Status: FAILED]
                            ┌─────┴─────┐   FallbackStatus:
                         Success     Fail   NOT_CONFIGURED
                            │           │   Installment: Unpaid
                            ▼           ▼
                       [Reconcile]  [Status: FAILED]
                       Status: Paid FallbackStatus: EXHAUSTED
```

---

## 4. Multi-Tenant Isolation & Idempotency Implementation

### Multi-Tenant Isolation:
- All database queries for `CollectionAttempt`, `RepaymentSchedule`, `Borrower`, and `ActiveLoan` are wrapped in `tenantContext` and automatically scoped by `tenantId`.
- Admin endpoints enforce `protect` middleware and tenant filtering.

### Idempotency Protections:
1. **Primary Collection Idempotency Key**: Generated as `LOAN:{loanId}:INSTALLMENT:{repaymentScheduleId}:ATTEMPT:{attemptNumber}` and indexed with partial unique constraints.
2. **Duplicate RealPay Webhook Protection**: Duplicate `SUCCESSFUL` or `UNSUCCESSFUL` webhooks return idempotent replayed responses without double-updating records or double-charging.
3. **Single PayFast Fallback Guarantee**: `triggerPayFastFallback` checks `originalAttemptId` before creating a fallback attempt, preventing duplicate fallback charges for the same RealPay failure event.
4. **Reconciliation Idempotency**: Payment record creation uses `TX-COLL-{collectionAttemptId}` as a unique transaction ID within the tenant.

---

## 5. Test Results Summary

All tests executed cleanly with zero failures.

| Test Suite | Total Tests | Status |
| :--- | :--- | :--- |
| `tests/unit/loanCollectionEngine.test.js` | 12 (covering 21 criteria) | **PASSED** |
| `tests/unit/collectionAttempt.test.js` | 4 | **PASSED** |
| `tests/unit/realpayService.test.js` | 46 | **PASSED** |
| `tests/unit/payfastService.test.js` | 11 | **PASSED** |
| `tests/unit/loanFinancialCalculator.test.js` | 24 | **PASSED** |
| `tests/unit/multiTenantIsolation.test.js` | 6 | **PASSED** |
| **Total Automated Tests Executed** | **103** | **100% PASSED** |

---

## 6. Verification of Deliverable Rules

- [x] ALL loan installments use DebiCheck (RealPay) as primary.
- [x] Tracking notification does NOT trigger PayFast & does NOT mark Paid.
- [x] RealPay `UNSUCCESSFUL` status is the ONLY trigger for PayFast fallback.
- [x] PayFast fallback checks borrower token; does not attempt fake charges if token is missing.
- [x] Existing loan financial calculations remain unchanged.
- [x] PayFast Marketplace & SaaS Subscription flows remain separate and functional.
- [x] NuPay references remain strictly 0 across the entire repository.

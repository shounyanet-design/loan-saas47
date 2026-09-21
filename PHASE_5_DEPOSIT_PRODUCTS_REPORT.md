# Phase 5 — Cooperative Bank Deposit Products Engine Report

**Execution Timestamp:** 2026-09-12  
**Module Name:** Cooperative Banking — Deposit Products Engine (`src/modules/cooperativeBank`)  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary & Architecture Compliance

Continuing from Phase 1 (Member Management), Phase 2 (Share Capital Engine), Phase 3 (Dividend Engine), and Phase 4 (Savings Account Engine), **Phase 5: Deposit Products Engine** has been created, integrated, and verified as a fully isolated Cooperative Banking subsystem inside `src/modules/cooperativeBank/`.

### Strict Engine Isolation Guarantee
In strict adherence to the project architecture, zero existing loan or payment infrastructure files were modified:
- **Loan Modules & Review Engine:** Unchanged (`src/models/Loan.js`, `src/controllers/loanApplicationController.js`, etc.)
- **Borrower Logic:** Unchanged (`src/models/Borrower.js`)
- **ActiveLoan Servicing:** Unchanged (`src/models/ActiveLoan.js`, `src/services/activeLoanServicingService.js`)
- **RepaymentSchedule & Due Payments:** Unchanged (`src/models/RepaymentSchedule.js`, `src/models/DuePayment.js`)
- **Payment Processing:** Unchanged (`src/models/Payment.js`)
- **RealPay Integration:** Unchanged (`src/services/realpay/`)
- **PayFast Integration:** Unchanged (`src/modules/commerce/`)
- **Loan Collection Engine:** Unchanged (`src/modules/loanCollection/`)

All deposit entities, number generators, validators, services, controllers, and routes are encapsulated in `src/modules/cooperativeBank/`.

---

## 2. Module Directory Structure & Components

```
src/modules/cooperativeBank/
├── controllers/
│   ├── memberController.js               # Phase 1 Member HTTP handlers
│   ├── shareController.js                # Phase 2 Share Capital HTTP handlers
│   ├── dividendController.js             # Phase 3 Dividend HTTP handlers
│   ├── savingsController.js              # Phase 4 Savings HTTP handlers
│   ├── fixedDepositController.js         # [NEW] Phase 5 Fixed Deposit HTTP handlers
│   └── recurringDepositController.js     # [NEW] Phase 5 Recurring Deposit HTTP handlers
├── models/
│   ├── Member.js                         # Phase 1 Cooperative Member model
│   ├── MemberSequence.js                 # Phase 1 Member sequence counter
│   ├── CooperativeAuditLog.js            # Audit trail (MEMBER_*, SHARE_*, DIVIDEND_*, SAVINGS_*, DEPOSIT_* actions)
│   ├── ShareAccount.js                   # Phase 2 Share capital account model
│   ├── ShareTransaction.js               # Phase 2 Share transaction ledger
│   ├── ShareSequence.js                  # Phase 2 Share sequence counter
│   ├── DividendCycle.js                  # Phase 3 Dividend cycle model
│   ├── MemberDividend.js                 # Phase 3 Member dividend allocation model
│   ├── SavingsAccount.js                 # Phase 4 Savings Account model
│   ├── SavingsTransaction.js             # Reused for Savings + Deposits (FIXED_DEPOSIT_CREATED, MATURITY_PAYMENT, etc.)
│   ├── SavingsSequence.js                # Atomic sequences (SAV-xxxxxx, TXN-SAV-xxxxxx, FD-xxxxxx, RD-xxxxxx)
│   ├── FixedDepositAccount.js            # [NEW] Phase 5 Fixed Deposit Account model
│   └── RecurringDepositAccount.js        # [NEW] Phase 5 Recurring Deposit Account model
├── routes/
│   ├── memberRoutes.js                   # /api/cooperative/members
│   ├── shareRoutes.js                    # /api/cooperative/shares
│   ├── dividendRoutes.js                 # /api/cooperative/dividends
│   ├── savingsRoutes.js                  # /api/cooperative/savings
│   ├── fixedDepositRoutes.js             # [NEW] /api/cooperative/fixed-deposits
│   └── recurringDepositRoutes.js         # [NEW] /api/cooperative/recurring-deposits
├── services/
│   ├── memberService.js                  # Phase 1 Member service
│   ├── memberNumberGenerator.js          # Phase 1 Number generator
│   ├── cooperativeAuditService.js        # Audit logging (members, shares, dividends, savings, deposits)
│   ├── shareService.js                   # Phase 2 Share service
│   ├── shareNumberGenerator.js           # Phase 2 Share number generator
│   ├── dividendService.js                # Phase 3 Dividend calculation & distribution service
│   ├── savingsService.js                 # Phase 4 Savings accounts, deposits, withdrawals, interest & statement
│   ├── savingsNumberGenerator.js         # Sequence generator (SAV, TXN, FD, RD)
│   └── depositService.js                 # [NEW] Phase 5 Fixed Deposit & Recurring Deposit business logic
├── validators/
│   ├── memberValidator.js                # Phase 1 Validator
│   ├── shareValidator.js                 # Phase 2 Validator
│   ├── dividendValidator.js              # Phase 3 Validator
│   ├── savingsValidator.js               # Phase 4 Validator
│   └── depositValidator.js               # [NEW] Phase 5 Validator
└── index.js                              # Consolidated public module export
```

---

## 3. Entity Specifications

### 1. `CooperativeFixedDepositAccount`
Defined in `src/modules/cooperativeBank/models/FixedDepositAccount.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Multi-tenant isolation via `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member holding the fixed deposit |
| `savingsAccountId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeSavingsAccount'` | Linked savings account for funding and payout |
| `depositNumber` | `String` | Required, Uppercase, Trimmed | Unique identifier (`FD-000001`, `FD-000002`) |
| `principalAmount` | `Number` | Required, Min: 0.01 | Initial deposit principal funded from savings |
| `interestRate` | `Number` | Required, Min: 0, Max: 100 | Annual interest percentage rate (e.g. `8.5`% p.a.) |
| `termMonths` | `Number` | Required, Min: 1 | Term duration in months |
| `startDate` | `Date` | Default: `Date.now` | Deposit activation date |
| `maturityDate` | `Date` | Required | Target date when deposit matures |
| `maturityAmount` | `Number` | Required, Min: 0 | Calculated total value upon maturity |
| `status` | `String` | Enum: `['ACTIVE', 'MATURED', 'CLOSED', 'EARLY_WITHDRAWAL']` | Operational status (Default: `'ACTIVE'`) |
| `closedDate` | `Date` | Default: `null` | Timestamp of account closure |
| `closureType` | `String` | Enum: `['MATURITY', 'EARLY_WITHDRAWAL', '']` | Reason/Type of closure |
| `payoutAmount` | `Number` | Default: 0 | Net payout amount credited to savings |
| `penaltyAmount` | `Number` | Default: 0 | Penalty deducted for early withdrawal |
| `penaltyRate` | `Number` | Default: 0 | Penalty percentage rate applied |
| `notes` | `String` | Default: `''` | Memo / Remarks |
| `createdBy` | `ObjectId` | `ref: 'User'` | User who initiated the fixed deposit |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Automatic Mongoose timestamps |

**Compound Indexes:**
- `{ tenantId: 1, depositNumber: 1 }` (Unique per tenant)
- `{ tenantId: 1, memberId: 1, status: 1 }`
- `{ tenantId: 1, savingsAccountId: 1 }`

---

### 2. `CooperativeRecurringDepositAccount`
Defined in `src/modules/cooperativeBank/models/RecurringDepositAccount.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Multi-tenant isolation via `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member holding the recurring deposit |
| `savingsAccountId` | `ObjectId` | Optional, Indexed, `ref: 'CooperativeSavingsAccount'` | Linked source savings account for contributions |
| `accountNumber` | `String` | Required, Uppercase, Trimmed | Unique identifier (`RD-000001`, `RD-000002`) |
| `monthlyAmount` | `Number` | Required, Min: 0.01 | Agreed regular monthly contribution |
| `durationMonths` | `Number` | Required, Min: 1 | Deposit tenure in months |
| `interestRate` | `Number` | Default: 6.0, Min: 0, Max: 100 | Annual interest percentage rate |
| `startDate` | `Date` | Default: `Date.now` | Agreement start date |
| `maturityDate` | `Date` | Required | Final completion date |
| `paidInstallments` | `Number` | Default: 0, Min: 0 | Counter of paid monthly installments |
| `missedInstallments` | `Number` | Default: 0, Min: 0 | Counter of overdue/missed installments |
| `totalDeposited` | `Number` | Default: 0, Min: 0 | Cumulative total of contributions made |
| `maturityAmount` | `Number` | Required, Min: 0 | Expected total maturity value |
| `status` | `String` | Enum: `['ACTIVE', 'COMPLETED', 'DEFAULTED', 'CLOSED']` | Operational status (Default: `'ACTIVE'`) |
| `installmentSchedule` | `Array` | Subdocuments | Array of monthly schedule items |
| `closedDate` | `Date` | Default: `null` | Timestamp when completed or closed |
| `payoutAmount` | `Number` | Default: 0 | Payout amount upon completion |
| `createdBy` | `ObjectId` | `ref: 'User'` | User who initiated the recurring deposit |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Automatic Mongoose timestamps |

**Installment Schedule Subdocument Schema:**
- `installmentNumber`: `Number` (1, 2, ... $n$)
- `dueDate`: `Date`
- `amount`: `Number`
- `status`: Enum `['PENDING', 'PAID', 'MISSED']` (Default: `'PENDING'`)
- `paidDate`: `Date` (Default: `null`)
- `transactionReference`: `String` (Default: `''`)

---

### 3. `SavingsTransaction` Ledger Reuse
The Phase 4 `SavingsTransaction` model is reused for deposit accounting with 4 new transaction types:
- `FIXED_DEPOSIT_CREATED`: Debits member's savings account when opening a Fixed Deposit.
- `MATURITY_PAYMENT`: Credits member's savings account upon FD maturity or early withdrawal net payout.
- `RECURRING_DEPOSIT_PAYMENT`: Debits member's savings account for monthly RD installment contributions.
- `PENALTY_CHARGED`: Ledger tracking for early withdrawal fee deductions.

---

### 4. Atomic Sequences
In `src/modules/cooperativeBank/services/savingsNumberGenerator.js`:
- `generateNextFixedDepositNumber(tenantId)`: Generates `FD-000001`, `FD-000002`...
- `generateNextRecurringDepositNumber(tenantId)`: Generates `RD-000001`, `RD-000002`...
- Guaranteed tenant isolation with zero concurrency race conditions using atomic `findOneAndUpdate`.

---

## 4. Business Logic & Calculation Engines

### 1. Fixed Deposit Calculation & Lifecycle
- **Interest & Maturity Formula:**
  $$\text{Interest} = \text{Round}\left(P \times \left(\frac{r}{100}\right) \times \left(\frac{t}{12}\right), 2\right)$$
  $$\text{MaturityAmount} = P + \text{Interest}$$
  Where:
  - $P$ = `principalAmount`
  - $r$ = `interestRate` (% annual)
  - $t$ = `termMonths`
- **Creation Workflow:**
  - Validates active member.
  - Verifies linked savings account has cleared balance $\ge P$.
  - Atomically debits $P$ from savings account.
  - Posts `FIXED_DEPOSIT_CREATED` completed transaction.
  - Generates `FD-xxxxxx` and persists `FixedDepositAccount`.
  - Emits `FIXED_DEPOSIT_CREATED` audit log.
- **Closure on Maturity:**
  - When closed on or after `maturityDate`:
    - `closureType = 'MATURITY'`
    - `payoutAmount = maturityAmount`
    - `penaltyAmount = 0`
    - Credits full payout amount to linked savings account.
    - Posts `MATURITY_PAYMENT` completed transaction.
    - Updates status to `'CLOSED'`.
    - Emits `FIXED_DEPOSIT_MATURED` audit log.
- **Early Withdrawal with Penalty:**
  - When closed before `maturityDate`:
    - Computes elapsed days: $d = \max(1, \lfloor(\text{now} - \text{startDate}) / 86400000\rfloor)$.
    - Applies penalty deduction rate ($pRate$):
      $$\text{effectiveRate} = \max(0, r - pRate)$$
      $$\text{earnedInterest} = \text{Round}\left(P \times \left(\frac{\text{effectiveRate}}{100}\right) \times \left(\frac{d}{365}\right), 2\right)$$
      $$\text{penaltyAmount} = \text{Round}\left(P \times \left(\frac{pRate}{100}\right) \times \left(\frac{d}{365}\right), 2\right)$$
      $$\text{payoutAmount} = P + \text{earnedInterest}$$
    - Credits net payout to savings account.
    - Posts `MATURITY_PAYMENT` and `PENALTY_CHARGED` transactions.
    - Updates status to `'EARLY_WITHDRAWAL'`.
    - Emits `EARLY_WITHDRAWAL` audit log.

### 2. Recurring Deposit Calculation & Lifecycle
- **Cumulative Maturity Formula (Classical Banking):**
  $$\text{TotalPrincipal} = P \times n$$
  $$\text{Interest} = \text{Round}\left(P \times \left(\frac{r}{1200}\right) \times \frac{n(n + 1)}{2}, 2\right)$$
  $$\text{MaturityAmount} = \text{TotalPrincipal} + \text{Interest}$$
  Where:
  - $P$ = `monthlyAmount`
  - $r$ = `interestRate` (% annual)
  - $n$ = `durationMonths`
- **Schedule Generation:**
  - Generates $n$ installment schedule records with respective due dates spaced 1 month apart.
- **Contribution / Payment Tracking:**
  - Identifies target installment (`PENDING` or `MISSED`).
  - Debits source savings account (if specified or linked).
  - Posts `RECURRING_DEPOSIT_PAYMENT` ledger transaction.
  - Updates installment: `status = 'PAID'`, `paidDate = now`.
  - Increments `paidInstallments += 1` and `totalDeposited += P`.
  - If installment was previously `'MISSED'`, decrements `missedInstallments`.
  - If all installments are paid (`paidInstallments >= durationMonths`), transitions to `'COMPLETED'`.
  - Emits `RECURRING_PAYMENT_RECEIVED` audit log.
- **Overdue Installments & Defaulting:**
  - Inspects schedule for items where `dueDate < now` and `status === 'PENDING'`.
  - Marks item as `'MISSED'`.
  - If `missedInstallments >= 3` and status is `'ACTIVE'`, transitions to `'DEFAULTED'`.
  - Emits `RECURRING_DEFAULT` audit log.

---

## 5. API Catalog & Routing

### Fixed Deposit Endpoints (`/api/cooperative/fixed-deposits`)
| Method | Endpoint | Description | Auth & Roles |
|---|---|---|---|
| `POST` | `/api/cooperative/fixed-deposits` | Create Fixed Deposit & debit savings account | `admin`, `staff` |
| `POST` | `/api/cooperative/fixed-deposits/:id/close` | Close FD (Maturity or Early Withdrawal with penalty) | `admin`, `staff` |
| `GET`  | `/api/cooperative/fixed-deposits/member/:memberId` | Retrieve all FDs & portfolio summary for a member | `admin`, `staff`, `agent` |
| `GET`  | `/api/cooperative/fixed-deposits/:id` | Retrieve single FD details and maturity statement | `admin`, `staff`, `agent` |

### Recurring Deposit Endpoints (`/api/cooperative/recurring-deposits`)
| Method | Endpoint | Description | Auth & Roles |
|---|---|---|---|
| `POST` | `/api/cooperative/recurring-deposits` | Create Recurring Deposit & generate monthly schedule | `admin`, `staff` |
| `POST` | `/api/cooperative/recurring-deposits/:id/payment` | Record monthly installment contribution | `admin`, `staff` |
| `GET`  | `/api/cooperative/recurring-deposits/member/:memberId` | Retrieve all RDs & portfolio summary for a member | `admin`, `staff`, `agent` |
| `GET`  | `/api/cooperative/recurring-deposits/:id` | Retrieve single RD details with installment schedule | `admin`, `staff`, `agent` |
| `POST` | `/api/cooperative/recurring-deposits/:id/check-missed` | Evaluate overdue installments and flag missed / default | `admin`, `staff` |

---

## 6. Audit Trail System

Audit logs are stored in `CooperativeAuditLog` with action types:
- `FIXED_DEPOSIT_CREATED`: Tracks principal, term, interest rate, maturity date, and deposit number.
- `FIXED_DEPOSIT_MATURED`: Tracks maturity payout, closed date, and final balance.
- `EARLY_WITHDRAWAL`: Tracks early closure, penalty deduction, and net payout.
- `RECURRING_DEPOSIT_CREATED`: Tracks monthly amount, duration, interest rate, and expected maturity.
- `RECURRING_PAYMENT_RECEIVED`: Tracks installment number, contribution amount, total deposited, and progress.
- `RECURRING_DEFAULT`: Tracks missed installment count and status transition to `DEFAULTED`.

---

## 7. Verification & Test Suite Results

### Phase 5 Test Suite (`tests/unit/cooperativeDepositProducts.test.js`)
17 comprehensive unit and controller tests executed via Node.js Native Test Runner with MongoDB In-Memory Server:

```text
# Subtest: COOPERATIVE BANK DEPOSIT PRODUCTS ENGINE — TEST SUITE
    ok 1 - 1. Fixed Deposit Creation — Debits savings account, generates FD-000001, calculates maturity amount
    ok 2 - 2. Validation — Blocks fixed deposit when savings account has insufficient funds
    ok 3 - 3. Maturity Closure — Closes matured FD, credits full maturity amount back to savings
    ok 4 - 4. Early Withdrawal — Applies penalty rate and transitions status to EARLY_WITHDRAWAL
    ok 5 - 5. Fixed Deposit Statement & Member Portfolio Summary
    ok 6 - 6. Recurring Deposit Creation — Computes cumulative formula, creates RD-000001 with schedule
    ok 7 - 7. Recurring Deposit Payment — Debits savings account and marks installment as PAID
    ok 8 - 8. Recurring Deposit Completion — Paying all installments marks account COMPLETED
    ok 9 - 9. Recurring Deposit Missed Payments & Default — Evaluates overdue schedule and marks DEFAULTED
    ok 10 - 10. Tenant Isolation — Tenant B starts deposit numbering at FD-000001 and RD-000001
    ok 11 - 11. Audit Logging — Verifies all 6 deposit product audit action types are recorded
    ok 12 - 12. API: POST /api/cooperative/fixed-deposits — Creates FD via HTTP controller (201 Created)
    ok 13 - 13. API: POST /api/cooperative/fixed-deposits/:id/close — Closes FD via HTTP controller (200 OK)
    ok 14 - 14. API: GET /api/cooperative/fixed-deposits/member/:memberId — Returns portfolio via HTTP controller (200 OK)
    ok 15 - 15. API: POST /api/cooperative/recurring-deposits — Creates RD via HTTP controller (201 Created)
    ok 16 - 16. API: POST /api/cooperative/recurring-deposits/:id/payment — Records RD payment via HTTP controller (200 OK)
    ok 17 - 17. API: GET /api/cooperative/recurring-deposits/member/:memberId — Returns member RDs via HTTP controller (200 OK)
# tests 17
# pass 17
# fail 0
```

### Cumulative Cooperative Bank Test Suite (`npm run test:cooperative`)
- Member Management: 18 passed
- Share Capital Engine: 17 passed
- Dividend Engine: 14 passed
- Savings Account Engine: 16 passed
- Deposit Products Engine: 17 passed
- **Total Cooperative Tests:** **82 passed, 0 failed across 5 test suites.**

### Full Application Regression Suite (`npm test`)
- Total Tests: **262 passed, 0 failed, 0 regressions** across all suites.
- Core Loan Management: Unchanged & 100% passing
- RealPay Integration: Unchanged & 100% passing
- PayFast Commerce: Unchanged & 100% passing
- Loan Servicing & Collection Engine: Unchanged & 100% passing

---

## 8. Conclusion

The Cooperative Bank Deposit Products Engine (Phase 5) is completely built, thoroughly tested, and fully integrated with zero disruption or alterations to existing loan, RealPay, PayFast, servicing, or collection systems.

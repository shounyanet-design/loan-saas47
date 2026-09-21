# Phase 4 — Cooperative Bank Savings Account Engine Report

**Execution Timestamp:** 2026-09-12  
**Module Name:** Cooperative Banking — Savings Account Engine (`src/modules/cooperativeBank`)  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary & Architecture Compliance

Following Phase 1 (Member Management), Phase 2 (Share Capital Engine), and Phase 3 (Dividend Engine), **Phase 4: Savings Account Engine** has been created, integrated, and verified as a fully isolated Cooperative Banking subsystem inside `src/modules/cooperativeBank/`.

### Strict Engine Isolation Guarantee
In strict adherence to the project requirements, zero existing loan or payment infrastructure files were modified:
- **Loan Modules & Review Engine:** Unchanged (`src/models/Loan.js`, `src/controllers/loanApplicationController.js`, etc.)
- **Borrower Logic:** Unchanged (`src/models/Borrower.js`)
- **ActiveLoan Servicing:** Unchanged (`src/models/ActiveLoan.js`, `src/services/activeLoanServicingService.js`)
- **RepaymentSchedule & Due Payments:** Unchanged (`src/models/RepaymentSchedule.js`, `src/models/DuePayment.js`)
- **Payment Processing:** Unchanged (`src/models/Payment.js`)
- **RealPay Integration:** Unchanged (`src/services/realpay/`)
- **PayFast Integration:** Unchanged (`src/modules/commerce/`)
- **Loan Collection Engine:** Unchanged (`src/modules/loanCollection/`)

All savings entities, number generators, validators, services, controllers, and routes are encapsulated in `src/modules/cooperativeBank/`.

---

## 2. Module Directory Structure & Components

```
src/modules/cooperativeBank/
├── controllers/
│   ├── memberController.js           # Phase 1 Member HTTP handlers
│   ├── shareController.js            # Phase 2 Share Capital HTTP handlers
│   ├── dividendController.js         # Phase 3 Dividend HTTP handlers
│   └── savingsController.js          # [NEW] Phase 4 Savings HTTP handlers
├── models/
│   ├── Member.js                     # Phase 1 Cooperative Member model
│   ├── MemberSequence.js             # Phase 1 Member sequence counter
│   ├── CooperativeAuditLog.js        # Audit trail (MEMBER_*, SHARE_*, DIVIDEND_*, SAVINGS_* actions)
│   ├── ShareAccount.js               # Phase 2 Share capital account model
│   ├── ShareTransaction.js           # Phase 2 Share transaction ledger
│   ├── ShareSequence.js              # Phase 2 Share sequence counter
│   ├── DividendCycle.js              # Phase 3 Dividend cycle model
│   ├── MemberDividend.js             # Phase 3 Member dividend allocation model
│   ├── SavingsAccount.js             # [NEW] Phase 4 Savings Account model
│   ├── SavingsTransaction.js         # [NEW] Phase 4 Savings Transaction ledger model
│   └── SavingsSequence.js            # [NEW] Phase 4 Atomic sequence counter for savings
├── routes/
│   ├── memberRoutes.js               # /api/cooperative/members
│   ├── shareRoutes.js                # /api/cooperative/shares
│   ├── dividendRoutes.js             # /api/cooperative/dividends
│   └── savingsRoutes.js              # [NEW] /api/cooperative/savings
├── services/
│   ├── memberService.js              # Phase 1 Member service
│   ├── memberNumberGenerator.js      # Phase 1 Number generator
│   ├── cooperativeAuditService.js    # Audit logging (members, shares, dividends, savings)
│   ├── shareService.js               # Phase 2 Share service
│   ├── shareNumberGenerator.js       # Phase 2 Share number generator
│   ├── dividendService.js            # Phase 3 Dividend calculation & distribution service
│   ├── savingsService.js             # [NEW] Phase 4 Savings accounts, deposits, withdrawals, interest & statement
│   └── savingsNumberGenerator.js     # [NEW] Phase 4 Atomic account number & reference generator
├── validators/
│   ├── memberValidator.js            # Phase 1 Validator
│   ├── shareValidator.js             # Phase 2 Validator
│   ├── dividendValidator.js          # Phase 3 Validator
│   └── savingsValidator.js           # [NEW] Phase 4 Validator
└── index.js                          # Consolidated public module export
```

---

## 3. Entity Specifications

### 1. `CooperativeSavingsAccount`
Defined in `src/modules/cooperativeBank/models/SavingsAccount.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Multi-tenant isolation via `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member holding the savings account |
| `accountNumber` | `String` | Required, Uppercase, Trimmed | Unique identifier (`SAV-000001`, `SAV-000002`) |
| `accountType` | `String` | Enum: `['NORMAL_SAVINGS', 'FIXED_DEPOSIT', 'RECURRING_DEPOSIT']` | Type of savings product (Default: `'NORMAL_SAVINGS'`) |
| `balance` | `Number` | Min: 0, Default: 0 | Current cleared savings balance |
| `interestRate` | `Number` | Min: 0, Max: 100, Default: 0 | Annual interest percentage rate (e.g. `4.5` = 4.5% p.a.) |
| `status` | `String` | Enum: `['ACTIVE', 'BLOCKED', 'CLOSED']` | Lifecycle status (Default: `'ACTIVE'`) |
| `openedDate` | `Date` | Default: `Date.now` | Account opening date |
| `lastInterestCalculationDate` | `Date` | Default: `null` | Timestamp of last interest calculation & posting |
| `closedDate` | `Date` | Default: `null` | Timestamp when account was marked closed |
| `closureReason` | `String` | Default: `''` | Reason for account closure |
| `createdBy` | `ObjectId` | `ref: 'User'` | User who initiated account creation |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Automatic Mongoose timestamps |

**Compound Indexes:**
- `{ tenantId: 1, accountNumber: 1 }` (Unique per tenant)
- `{ tenantId: 1, memberId: 1, status: 1 }`
- `{ tenantId: 1, accountType: 1, status: 1 }`

---

### 2. `CooperativeSavingsTransaction`
Defined in `src/modules/cooperativeBank/models/SavingsTransaction.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Multi-tenant isolation via `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member associated with transaction |
| `savingsAccountId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeSavingsAccount'` | Targeted savings account |
| `transactionType` | `String` | Enum: `['DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'ADJUSTMENT']` | Transaction classification |
| `status` | `String` | Enum: `['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED']` | Operational status (Default: `'COMPLETED'`, withdrawals start `'REQUESTED'`) |
| `amount` | `Number` | Required, Min: 0.01 | Transaction monetary magnitude |
| `balanceBefore` | `Number` | Default: 0 | Balance immediately prior to transaction completion |
| `balanceAfter` | `Number` | Default: 0 | Balance immediately following transaction completion |
| `reference` | `String` | Required, Uppercase, Trimmed | Unique tracking reference (`TXN-SAV-000001` or custom) |
| `description` | `String` | Default: `''` | Transaction description / ledger memo |
| `requestedDate` | `Date` | Default: `Date.now` | Date when withdrawal request was lodged |
| `approvedBy` | `ObjectId` | `ref: 'User'` | Supervisor/Admin who approved the withdrawal |
| `approvedDate` | `Date` | Default: `null` | Timestamp of withdrawal approval |
| `rejectionReason` | `String` | Default: `''` | Reason provided if withdrawal request is rejected |
| `approvalNotes` | `String` | Default: `''` | Notes logged during approval review |
| `createdBy` | `ObjectId` | `ref: 'User'` | Initiator / Teller |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Automatic Mongoose timestamps |

**Compound Indexes:**
- `{ tenantId: 1, reference: 1 }` (Unique per tenant)
- `{ tenantId: 1, savingsAccountId: 1, createdAt: -1 }`
- `{ tenantId: 1, memberId: 1, transactionType: 1 }`
- `{ tenantId: 1, status: 1 }`

---

### 3. `CooperativeSavingsSequence`
Defined in `src/modules/cooperativeBank/models/SavingsSequence.js`:
- Uses atomic `findOneAndUpdate` with `$inc: { seq: 1 }` and `upsert: true`.
- Zero race conditions under high concurrent volume.
- Tenant isolated: sequences are scoped by `{ tenantId, sequenceType }`.
- Sequences:
  - `SAVINGS_ACCOUNT`: Formats to `SAV-000001`, `SAV-000002`...
  - `SAVINGS_TRANSACTION`: Formats to `TXN-SAV-000001`, `TXN-SAV-000002`...

---

## 4. Business Logic & Core Workflows

### 1. Account Creation
- Verifies member exists and has `membershipStatus === 'ACTIVE'`.
- Generates sequential, tenant-scoped account number (`SAV-xxxxxx`).
- Supports optional initial deposit at opening. If initial deposit is supplied:
  - Initial deposit is atomically credited.
  - A `DEPOSIT` transaction is posted with `status: 'COMPLETED'`.
  - An audit log `DEPOSIT_CREATED` is emitted in addition to `SAVINGS_ACCOUNT_CREATED`.

### 2. Deposit Processing
- Verifies account is `ACTIVE`.
- Ensures deposit amount > 0.
- Calculates `balanceBefore` and `balanceAfter = balanceBefore + amount`.
- Creates atomic `SavingsTransaction` with `transactionType: 'DEPOSIT'` and `status: 'COMPLETED'`.
- Atomically updates account balance using `$inc`.
- Logs `DEPOSIT_CREATED` audit event.

### 3. Two-Step Withdrawal Workflow with Guardrails
1. **Withdrawal Request (`POST /withdraw`):**
   - Validates that the account has sufficient available cleared balance (`balance >= amount`).
   - Generates unique reference `TXN-SAV-xxxxxx`.
   - Creates `SavingsTransaction` with `transactionType: 'WITHDRAWAL'` and `status: 'REQUESTED'`.
   - **Balance remains unchanged** at this stage (no pre-mature debit).
   - Logs `WITHDRAWAL_REQUESTED` audit event.
2. **Withdrawal Approval (`PATCH /withdraw/:id/approve`):**
   - Role-restricted to `admin`, `tenant_super_admin`, or `tenant_manager`.
   - Checks that withdrawal transaction is currently in `REQUESTED` status.
   - Re-verifies account has sufficient funds (`balance >= amount`) to prevent overdraft during review delays.
   - Atomically updates transaction: `status: 'COMPLETED'`, `balanceBefore`, `balanceAfter = balanceBefore - amount`, `approvedBy`, `approvedDate: Date.now()`.
   - Atomically decrements account balance via `$inc: { balance: -amount }`.
   - Logs `WITHDRAWAL_APPROVED` audit event.
3. **Withdrawal Rejection (`PATCH /withdraw/:id/reject`):**
   - Role-restricted to supervisors/admins.
   - Checks that withdrawal transaction is currently in `REQUESTED` status.
   - Updates transaction `status: 'REJECTED'`, stamps `rejectionReason`, `approvedBy`, `approvedDate`.
   - **Balance remains unchanged**.
   - Logs `WITHDRAWAL_REJECTED` audit event.

### 4. Interest Calculation Engine
- Calculation formula:
  $$\text{Interest} = \text{Round}\left(P \times \left(\frac{r}{100}\right) \times \left(\frac{t}{365}\right), 2\right)$$
  Where:
  - $P$ = Current cleared account balance
  - $r$ = Annual interest percentage rate (`interestRate`)
  - $t$ = Calculation accrual period in days (default: 30 days)
- If calculated interest > 0:
  - Atomically credits interest to account balance.
  - Generates `INTEREST` transaction with `status: 'COMPLETED'`.
  - Sets `lastInterestCalculationDate = Date.now()`.
  - Emits `INTEREST_POSTED` audit event.

### 5. Detailed Account Statement Generation
- Retrieves running ledger for any savings account.
- Filters by date range (`startDate`, `endDate`) and optional `transactionType`.
- Calculates comprehensive financial summary:
  - `openingBalance` (balance before `startDate` or at opening)
  - `closingBalance` (current account balance)
  - `totalDeposits`
  - `totalWithdrawals`
  - `totalInterest`
  - `netChange`
- Paginated transaction list with human-readable running details.

---

## 5. API Catalog & Routing

Mounted at `/api/cooperative/savings` in `src/app.js`:

| Method | Endpoint | Description | Auth & Roles |
|---|---|---|---|
| `POST` | `/api/cooperative/savings/accounts` | Open savings account (with optional initial deposit) | Authenticated, Tenant Scoped |
| `POST` | `/api/cooperative/savings/deposit` | Deposit funds into savings account | Authenticated, Tenant Scoped |
| `POST` | `/api/cooperative/savings/withdraw` | Submit withdrawal request | Authenticated, Tenant Scoped |
| `PATCH`| `/api/cooperative/savings/withdraw/:id/approve` | Approve withdrawal and debit funds | `admin`, `tenant_super_admin`, `tenant_manager` |
| `PATCH`| `/api/cooperative/savings/withdraw/:id/reject` | Reject withdrawal request | `admin`, `tenant_super_admin`, `tenant_manager` |
| `POST` | `/api/cooperative/savings/calculate-interest` | Calculate and post interest | `admin`, `tenant_super_admin`, `tenant_manager` |
| `GET`  | `/api/cooperative/savings/member/:memberId` | Get all savings accounts for member & summary | Authenticated, Tenant Scoped |
| `GET`  | `/api/cooperative/savings/:accountId` | Get single savings account details | Authenticated, Tenant Scoped |
| `GET`  | `/api/cooperative/savings/:accountId/statement` | Get detailed account ledger statement | Authenticated, Tenant Scoped |

---

## 6. Audit Trail System

Audit logs are stored in `CooperativeAuditLog` with action types:
- `SAVINGS_ACCOUNT_CREATED`: Tracks member, account number, account type, initial balance.
- `DEPOSIT_CREATED`: Tracks deposit amount, balance after, reference.
- `WITHDRAWAL_REQUESTED`: Tracks requested amount, initiator, reference.
- `WITHDRAWAL_APPROVED`: Tracks approved amount, approver, updated balance.
- `WITHDRAWAL_REJECTED`: Tracks rejected amount, rejection reason.
- `INTEREST_POSTED`: Tracks interest rate, days calculated, interest earned, balance after.

---

## 7. Verification & Test Suite Results

### Phase 4 Test Suite (`tests/unit/cooperativeSavingsEngine.test.js`)
16 comprehensive unit and controller tests executed via Node.js Native Test Runner with MongoDB In-Memory Server:

```text
# Subtest: COOPERATIVE BANK SAVINGS ACCOUNT ENGINE — TEST SUITE
    ok 1 - 1. Account Creation — Opens NORMAL_SAVINGS account with initial deposit and generates SAV-000001
    ok 2 - 2. Deposit Calculations — Accurately credits account and logs ledger transaction
    ok 3 - 3. Withdrawal Workflow — Step 1: Initiates request with status REQUESTED (balance not debited yet)
    ok 4 - 4. Withdrawal Workflow — Step 2: Approves withdrawal, debits balance (1500 - 400 = 1100), stamps approvedBy
    ok 5 - 5. Withdrawal Rejection — Rejects withdrawal request without balance deduction and records reason
    ok 6 - 6. Validation — Blocks withdrawal request exceeding available balance (Insufficient Funds)
    ok 7 - 7. Interest Calculation — Calculates and credits interest based on balance, rate and days
    ok 8 - 8. Account Statement — Generates statement with running transactions, deposits, withdrawals and interest totals
    ok 9 - 9. Member Savings Summary — Retrieves member cumulative savings balance
    ok 10 - 10. Tenant Isolation — Tenant B starts independent sequence at SAV-000001
    ok 11 - 11. Audit Logs — Verifies SAVINGS_ACCOUNT_CREATED, DEPOSIT_CREATED, WITHDRAWAL_REQUESTED, WITHDRAWAL_APPROVED, WITHDRAWAL_REJECTED, INTEREST_POSTED
    ok 12 - 12. API: POST /api/cooperative/savings/accounts — Opens account via HTTP controller (201 Created)
    ok 13 - 13. API: POST /api/cooperative/savings/deposit — Deposits funds via HTTP controller (200 OK)
    ok 14 - 14. API: POST /api/cooperative/savings/withdraw — Submits withdrawal request via HTTP controller (200 OK)
    ok 15 - 15. API: GET /api/cooperative/savings/member/:memberId — Retrieves member accounts via HTTP controller (200 OK)
    ok 16 - 16. API: GET /api/cooperative/savings/:accountId/statement — Retrieves statement via HTTP controller (200 OK)
# tests 16
# pass 16
# fail 0
```

### Cumulative Cooperative Bank Test Suite (`npm run test:cooperative`)
- Member Management: 18 passed
- Share Capital Engine: 17 passed
- Dividend Engine: 14 passed
- Savings Account Engine: 16 passed
- **Total Cooperative Tests:** **65 passed, 0 failed across 4 test suites.**

---

## 8. Conclusion

The Cooperative Bank Savings Account Engine (Phase 4) is completely built, thoroughly tested, and fully integrated with zero disruption or alterations to existing loan, RealPay, PayFast, servicing, or collection systems.

# Phase 2 — Cooperative Bank Share Capital Engine Report

**Execution Timestamp:** 2026-09-12  
**Module Name:** Cooperative Banking — Share Capital Engine (`src/modules/cooperativeBank`)  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary & Architecture Compliance

Continuing from Phase 1 Member Management, **Phase 2: Share Capital Engine** has been implemented and fully verified as an isolated subsystem within `src/modules/cooperativeBank/`.

### Strict Engine Isolation Guarantee
In strict adherence to architectural directives, all existing credit, payment, and collection modules were preserved with **zero modifications**:
- **Loan Modules & Reviews:** Unchanged (`src/models/Loan.js`, `src/controllers/loanApplicationController.js`, etc.)
- **Borrower Logic:** Unchanged (`src/models/Borrower.js`)
- **ActiveLoan Servicing:** Unchanged (`src/models/ActiveLoan.js`, `src/services/activeLoanServicingService.js`)
- **RepaymentSchedule & Due Payments:** Unchanged (`src/models/RepaymentSchedule.js`, `src/models/DuePayment.js`)
- **Payment Processing:** Unchanged (`src/models/Payment.js`)
- **RealPay Debit Order Engine:** Unchanged (`src/services/realpay/`)
- **PayFast Commerce & Subscriptions:** Unchanged (`src/modules/commerce/`)
- **Loan Collection Engine:** Unchanged (`src/modules/loanCollection/`)

---

## 2. Module Directory Structure & Components

```
src/modules/cooperativeBank/
├── controllers/
│   ├── memberController.js           # Phase 1 Member HTTP handlers
│   └── shareController.js            # [NEW] Phase 2 Share Capital HTTP handlers
├── models/
│   ├── Member.js                     # Phase 1 Cooperative Member model
│   ├── MemberSequence.js             # Phase 1 Member sequence counter
│   ├── CooperativeAuditLog.js        # Audit trail (supports MEMBER_* and SHARE_* actions)
│   ├── ShareAccount.js               # [NEW] Share capital accounts with tenantPlugin
│   ├── ShareTransaction.js           # [NEW] Share transaction ledger with tenantPlugin
│   └── ShareSequence.js              # [NEW] Atomic counter for SHR-xxxxxx & TXN-SHR-xxxxxx
├── routes/
│   ├── memberRoutes.js               # Phase 1 Member endpoints (/api/cooperative/members)
│   └── shareRoutes.js                # [NEW] Phase 2 Share endpoints (/api/cooperative/shares)
├── services/
│   ├── memberService.js              # Phase 1 Member lifecycle service
│   ├── memberNumberGenerator.js      # Phase 1 Member numbering service
│   ├── cooperativeAuditService.js    # Audit logging for members and shares
│   ├── shareService.js               # [NEW] Share purchase, portfolio, and reports
│   └── shareNumberGenerator.js       # [NEW] Atomic SHR-000001 & TXN-SHR-000001 generator
├── validators/
│   ├── memberValidator.js            # Phase 1 Member Joi schemas
│   └── shareValidator.js             # [NEW] Phase 2 Share Joi schemas
└── index.js                          # Consolidated module export
```

---

## 3. Entity Specifications

### 1. `CooperativeShareAccount`
Defined in `src/modules/cooperativeBank/models/ShareAccount.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Scoped and guarded by `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member owning the share account |
| `shareNumber` | `String` | Required, Uppercase, Unique per tenant | Unique account ID (`SHR-000001`) |
| `numberOfShares` | `Number` | Required, Min: 0, Default: 0 | Current number of shares held |
| `shareValue` | `Number` | Required, Min: 0 | Par value / price per share |
| `totalInvestment` | `Number` | Required, Min: 0, Default: 0 | Total capital contributed (`shares * value`) |
| `purchaseDate` | `Date` | Default: `Date.now` | First acquisition date |
| `status` | `String` | Enum: `['ACTIVE', 'INACTIVE', 'FROZEN', 'TRANSFERRED', 'CLOSED']` | Account status (Default: `'ACTIVE'`) |
| `createdBy` | `ObjectId` | `ref: 'User'` | Admin/Staff user who opened the account |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Mongoose auto-timestamps |

**Compound Indexes:**
- `{ tenantId: 1, shareNumber: 1 }` (Unique)
- `{ tenantId: 1, memberId: 1 }`
- `{ tenantId: 1, status: 1 }`

---

### 2. `CooperativeShareTransaction`
Defined in `src/modules/cooperativeBank/models/ShareTransaction.js`:

| Field | Type | Rules & Defaults | Description |
|---|---|---|---|
| `tenantId` | `ObjectId` | Indexed, `ref: 'Tenant'` | Scoped and guarded by `tenantPlugin` |
| `memberId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeMember'` | Member transacting |
| `shareAccountId` | `ObjectId` | Required, Indexed, `ref: 'CooperativeShareAccount'` | Target share account |
| `transactionType`| `String` | Enum: `['PURCHASE', 'TRANSFER', 'ADJUSTMENT']` | Ledger transaction type |
| `numberOfShares` | `Number` | Required | Quantity of shares in this transaction |
| `amount` | `Number` | Required | Total financial consideration |
| `reference` | `String` | Required, Uppercase, Unique per tenant | Unique reference (`TXN-SHR-000001` or custom) |
| `metadata` | `Map` | Key-value store | Payment method, notes, transfer counterparts |
| `createdBy` | `ObjectId` | `ref: 'User'` | User recording transaction |
| `timestamps` | `Date` | `createdAt`, `updatedAt` | Mongoose auto-timestamps |

**Compound Indexes:**
- `{ tenantId: 1, reference: 1 }` (Unique)
- `{ tenantId: 1, shareAccountId: 1, createdAt: -1 }`
- `{ tenantId: 1, memberId: 1, createdAt: -1 }`

---

## 4. Share Numbering & Idempotency Engines

Implemented in `src/modules/cooperativeBank/services/shareNumberGenerator.js`:
- **Share Number Format:** `SHR-000001`, `SHR-000002`...
- **Transaction Reference Format:** `TXN-SHR-000001`, `TXN-SHR-000002`...
- **Atomic Operations:** Uses MongoDB `findOneAndUpdate` with `$inc: { seq: 1 }` and `upsert: true` on `CooperativeShareSequence`.
- **Duplicate Prevention:** If a client passes an existing transaction reference, the service detects the duplicate and rejects it with `409 Conflict` (`DUPLICATE_REFERENCE`).

---

## 5. Share Purchase & Investment Calculation Engine

1. **Member Eligibility Guard:**
   - Members must exist in current tenant and possess `ACTIVE` membership status.
   - Any purchase attempt for `PENDING`, `SUSPENDED`, or `CLOSED` members is blocked with `400 Bad Request` (`MEMBER_NOT_ACTIVE`).
2. **Financial Precision:**
   - Evaluates: $\text{amount} = \text{numberOfShares} \times \text{shareValue}$.
   - Rounded to 2 decimal places to eliminate floating point rounding errors.
3. **Account Accumulation:**
   - If the member already has an active share account, subsequent purchases increment `numberOfShares` and `totalInvestment` without duplicating accounts.
   - Each purchase records an immutable `ShareTransaction` of type `'PURCHASE'`.

---

## 6. API Endpoints Specification

All routes are mounted at `/api/cooperative/shares`:

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `POST` | `/api/cooperative/shares/purchase` | `admin`, `staff` | Purchases shares for an active member. Generates share number or updates existing account, logs ledger transaction, and emits audit event. |
| `GET` | `/api/cooperative/shares/member/:memberId` | `admin`, `staff`, `agent` | Retrieves member share portfolio, active account details, transaction history, and calculated cooperative ownership percentage. |
| `GET` | `/api/cooperative/shares/report` | `admin`, `staff` | Generates cooperative-wide share capital report with total capitalization, shareholder count, top shareholders, and transaction breakdown. |
| `GET` | `/api/cooperative/shares/:id` | `admin`, `staff`, `agent` | Retrieves individual share account details with populated member details and chronological transaction ledger. |

---

## 7. Audit Events

Recorded in `CooperativeAuditLog`:
- `SHARE_PURCHASED`: Captured on every share purchase with share account number, member number, share count, transaction amount, and actor snapshot.
- `SHARE_TRANSFERRED`: Reserved for share transfer transactions.
- `SHARE_ADJUSTED`: Reserved for capital adjustment operations.

---

## 8. Verification & Automated Test Results

### Dedicated Test Suite:
```bash
NODE_ENV=test node --test tests/unit/cooperativeShareEngine.test.js
```
**Results:** **17 / 17 Passing** (0 Failures).

1. `Share Purchase` — Verified `SHR-000001` generation, status `ACTIVE`, and correct `totalInvestment` calculation ($50 \times 10 = 500$).
2. `Account Accumulation` — Verified subsequent purchases accumulate on the existing account ($75$ shares, $800$ total).
3. `Multi-Member Sequencing` — Verified second member receives sequential `SHR-000002`.
4. `Status Validation` — Blocked share purchase for `PENDING` member with `400 Bad Request`.
5. `Mathematical Validation` — Rejected negative and zero share counts and share values.
6. `Duplicate Reference Guard` — Blocked duplicate transaction references with `409 Conflict`.
7. `Tenant Isolation Sequencing` — Verified Tenant B starts its own independent numbering at `SHR-000001`.
8. `Cross-Tenant Security Barrier` — Blocked cross-tenant share purchases and account lookups (returns 404).
9. `Ownership Tracking` — Verified `getSharesByMember` accurately computes percentage ownership and investment totals.
10. `Account Lookup by ID` — Verified `getShareAccountById` populates member and transactions.
11. `Share Capital Report` — Verified `getShareReport` calculates cooperative total shares, capital, and top shareholders.
12. `Audit Log Persistence` — Verified `SHARE_PURCHASED` audit entries are created with diffs and actor details.
13-17. `API Controllers` — Verified HTTP status codes (201, 200, 400), payload structures, and error responses.

### Full Regression Suite:
```bash
npm test
```
**Results:** **215 / 215 Passing** (0 Failures, 0 Regressions).
- Core Loan Management: Unchanged & passing
- RealPay Debit Order: Unchanged & passing
- PayFast Commerce: Unchanged & passing
- Loan Collection Engine: Unchanged & passing
- Phase 1 Member Management: Unchanged & passing
- Phase 2 Share Capital Engine: Unchanged & passing

---

## 9. Conclusion

Phase 2 Cooperative Bank Share Capital Engine is fully implemented, verified, isolated, and operational. The platform is ready for Phase 3 extension (Savings Accounts, Deposit Engine, or Cooperative Dividends).

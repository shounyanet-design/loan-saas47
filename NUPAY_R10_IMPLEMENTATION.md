# NuPay R10 Controlled-Test Implementation

Implemented in this package:

- Official DebiCheck mandate initiation endpoint.
- Base64 `username:password` authentication.
- Exact 15-digit card-acceptor formatting.
- Validation for mandate initiation cross-field rules.
- Accepted, Pending Auth, Rejected, Suspended and No Response normalization.
- Idempotent admin mandate initiation.
- TT1 endpoint registration.
- Public TT1 callback with optional shared-secret header.
- Mandate and instalment report service methods.
- Persistent sanitized NuPay mandate state on `LoanApplication`.
- Node built-in test runner (`npm test`).

## Admin endpoints

- `POST /api/admin/nupay/mandates/initiate`
- `POST /api/admin/nupay/tt1/register-endpoint`
- `POST /api/admin/nupay/reports/mandates`
- `POST /api/admin/nupay/reports/instalments`

## Callback endpoint

- `POST /api/v1/nupay/tt1/callback`

## Controlled R10 request

Use `instalmentAmount: "10.00"` and `maxCollectionAmount: "10.00"` only after NuPay confirms test credentials and merchant configuration.

## Not included yet

Mandate maintenance/cancellation, employer-code maintenance, instalment add/maintain/reschedule/cancel/reactivate/recall, settlement report, and strike-date analysis remain for the next package.

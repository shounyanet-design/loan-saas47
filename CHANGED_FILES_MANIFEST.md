# Point.47 NuPay R10 - Changed Files Only

Copy/merge these files into the existing backend project while preserving the folder structure.

## Included files
- `src/utils/nupayValidation.js`
- `src/services/nupayService.js`
- `src/controllers/admin/nupayController.js`
- `src/routes/admin/nupayRoutes.js`
- `src/controllers/nupayController.js`
- `src/routes/nupayRoutes.js`
- `src/models/LoanApplication.js`
- `src/modules/saas/services/credentialService.js`
- `tests/unit/nupayService.test.js`
- `package.json`
- `.env.nupay.example`
- `NUPAY_R10_IMPLEMENTATION.md`

## Recommended verification

```bash
npm install
npm run check
npm run test:nupay
```

Do not perform a live R10 call until local checks pass and NuPay confirms the test merchant credentials.

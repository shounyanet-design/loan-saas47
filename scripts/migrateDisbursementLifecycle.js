/**
 * migrateDisbursementLifecycle.js
 *
 * Fixes Classification C loans (premature ActiveLoan) by updating the
 * LoanApplication to DISBURSED status and linking activeLoanId.
 *
 * Usage:
 *   node scripts/migrateDisbursementLifecycle.js --dry-run     (safe preview)
 *   node scripts/migrateDisbursementLifecycle.js --apply       (write to DB)
 *   node scripts/migrateDisbursementLifecycle.js --id <mongoId> --apply   (single loan)
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const DRY_RUN = !process.argv.includes('--apply');
const SPECIFIC_ID = (() => {
  const idx = process.argv.indexOf('--id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Migration] Connected. dry-run =', DRY_RUN);

  const LoanApplication = require('../src/models/LoanApplication');
  const ActiveLoan = require('../src/models/ActiveLoan');
  const tenantCtx = require('../src/tenancy/tenantContext');

  // Find all premature active loans:
  // ActiveLoan exists but LoanApplication is NOT DISBURSED
  const filter = SPECIFIC_ID ? { loanApplicationId: SPECIFIC_ID } : {};
  const activeLoans = await tenantCtx.runAsSystem(() =>
    ActiveLoan.find(filter).lean()
  );

  const results = [];

  for (const al of activeLoans) {
    const app = await tenantCtx.runAsSystem(() =>
      LoanApplication.findById(al.loanApplicationId).lean()
    );
    if (!app) {
      results.push({ activeLoanId: al._id, error: 'LoanApplication not found' });
      continue;
    }

    const isDisbursed = app.status === 'DISBURSED' || app.disbursementStatus === 'DISBURSED';
    if (isDisbursed) {
      results.push({
        applicationId: app.applicationId,
        activeLoanId: al._id,
        classification: 'A - Already DISBURSED — skipped',
      });
      continue;
    }

    // Validate gates before migrating
    const agreementSigned = app.agreementStatus === 'SIGNED' || app.agreementSignedAt;
    const mandateAccepted =
      app.debicheckMandateStatus === 'ACCEPTED' ||
      app.realPayMandate?.status === 'ACCEPTED' ||
      app.nupayMandate?.outcome === 'ACCEPTED';

    if (!agreementSigned || !mandateAccepted) {
      results.push({
        applicationId: app.applicationId,
        activeLoanId: al._id,
        classification: 'C - Gates not satisfied, manual review required',
        agreementSigned,
        mandateAccepted,
      });
      continue;
    }

    const entry = {
      applicationId: app.applicationId,
      activeLoanId: al._id,
      tenantId: app.tenantId,
      classification: 'C - Premature ActiveLoan → promoting to DISBURSED',
      dryRun: DRY_RUN,
    };

    if (!DRY_RUN) {
      await tenantCtx.runAsSystem(() =>
        LoanApplication.findByIdAndUpdate(app._id, {
          $set: {
            status: 'DISBURSED',
            disbursementStatus: 'DISBURSED',
            disbursedAt: al.createdAt || new Date(),
            activeLoanId: al._id,
          },
          $push: {
            statusHistory: {
              status: 'DISBURSED',
              changedBy: 'Migration Script',
              notes: 'Migrated from premature ActiveLoan created during agreement signing.',
              changedAt: new Date(),
            }
          }
        })
      );

      await tenantCtx.runAsSystem(() =>
        ActiveLoan.findByIdAndUpdate(al._id, {
          $set: { disbursementStatus: 'DISBURSED', disbursementReady: false }
        })
      );

      entry.applied = true;
    }

    results.push(entry);
  }

  console.log(JSON.stringify({ migrationRun: new Date().toISOString(), dryRun: DRY_RUN, results }, null, 2));
  await mongoose.disconnect();
  console.log('[Migration] Done.');
}

run().catch(err => {
  console.error('[Migration] Fatal:', err.message);
  process.exit(1);
});

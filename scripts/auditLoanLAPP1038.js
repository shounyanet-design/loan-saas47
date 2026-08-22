/**
 * auditLoanLAPP1038.js
 * Read-only audit report for LAPP-1038 (Mongo ID: 6a81e933527ec0956173109c)
 *
 * Usage:
 *   node scripts/auditLoanLAPP1038.js
 *
 * Outputs a JSON report to stdout classifying the loan's current state.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const TARGET_ID = '6a81e933527ec0956173109c';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.error('[Audit] Connected to MongoDB');

  // Load models in system context (no tenant filter)
  const LoanApplication = require('../src/models/LoanApplication');
  const ActiveLoan = require('../src/models/ActiveLoan');

  // Dynamically require RepaymentSchedule and Payment if they exist
  let RepaymentSchedule, Payment;
  try { RepaymentSchedule = require('../src/models/RepaymentSchedule'); } catch (_) {}
  try { Payment = require('../src/models/Payment'); } catch (_) {}

  const tenantCtx = require('../src/tenancy/tenantContext');

  const application = await tenantCtx.runAsSystem(() =>
    LoanApplication.findById(TARGET_ID).lean()
  );

  if (!application) {
    console.log(JSON.stringify({ error: 'LoanApplication not found', targetId: TARGET_ID }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const activeLoans = await tenantCtx.runAsSystem(() =>
    ActiveLoan.find({ loanApplicationId: TARGET_ID }).lean()
  );

  const repayments = RepaymentSchedule
    ? await tenantCtx.runAsSystem(() =>
        RepaymentSchedule.find({
          loanId: { $in: activeLoans.map(l => l._id) }
        }).lean()
      )
    : [];

  const payments = Payment
    ? await tenantCtx.runAsSystem(() =>
        Payment.find({ loanApplicationId: TARGET_ID }).lean()
      )
    : [];

  // Classification
  let classification = 'UNKNOWN';
  let recommendation = '';

  const hasActiveLoan = activeLoans.length > 0;
  const isDisbursed = application.status === 'DISBURSED' || application.disbursementStatus === 'DISBURSED';
  const isReadyForDisbursement = application.disbursementStatus === 'READY_FOR_DISBURSEMENT' ||
    application.status === 'Ready for Disbursement' || application.status === 'READY_FOR_DISBURSEMENT';

  if (isDisbursed && hasActiveLoan) {
    classification = 'A - CORRECTLY_DISBURSED';
    recommendation = 'No action required. LoanApplication is DISBURSED and ActiveLoan exists.';
  } else if (isDisbursed && !hasActiveLoan) {
    classification = 'B - DISBURSED_WITHOUT_ACTIVE_LOAN';
    recommendation = 'WARNING: LoanApplication shows DISBURSED but no ActiveLoan exists. Run migration to create ActiveLoan.';
  } else if (!isDisbursed && hasActiveLoan) {
    classification = 'C - PREMATURE_ACTIVE_LOAN';
    recommendation = 'WARNING: ActiveLoan exists but LoanApplication is not DISBURSED. This is likely a premature creation. ' +
      'If the loan is genuinely disbursed, update LoanApplication.status = DISBURSED and LoanApplication.disbursementStatus = DISBURSED. ' +
      'If not, the ActiveLoan should be reviewed.';
  } else if (isReadyForDisbursement && !hasActiveLoan) {
    classification = 'D - READY_AWAITING_DISBURSEMENT';
    recommendation = 'Application is ready for disbursement. Admin must trigger POST /api/admin/loans/' + TARGET_ID + '/disburse.';
  } else {
    classification = 'E - PENDING_OR_OTHER';
    recommendation = 'Application is not yet at a disbursement stage. No action required.';
  }

  const report = {
    auditTimestamp: new Date().toISOString(),
    targetId: TARGET_ID,
    loanApplication: {
      _id: application._id,
      applicationId: application.applicationId,
      tenantId: application.tenantId,
      status: application.status,
      disbursementStatus: application.disbursementStatus,
      agreementStatus: application.agreementStatus,
      debicheckMandateStatus: application.debicheckMandateStatus,
      nupayMandateOutcome: application.nupayMandate?.outcome,
      realPayMandateStatus: application.realPayMandate?.status,
      agreementSignedAt: application.agreementSignedAt,
      disbursedAt: application.disbursedAt,
      activeLoanId: application.activeLoanId,
      requestedAmount: application.requestedAmount,
      approvedAmount: application.approvedAmount,
      interestRate: application.interestRate,
      requestedDuration: application.requestedDuration,
      createdAt: application.createdAt,
    },
    activeLoans: activeLoans.map(al => ({
      _id: al._id,
      tenantId: al.tenantId,
      disbursementStatus: al.disbursementStatus,
      disbursementReady: al.disbursementReady,
      agreementStatus: al.agreementStatus,
      approvedAmount: al.approvedAmount,
      emiAmount: al.emiAmount,
      remainingBalance: al.remainingBalance,
      createdAt: al.createdAt,
    })),
    repaymentScheduleCount: repayments.length,
    paymentsCount: payments.length,
    classification,
    recommendation,
  };

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
  console.error('[Audit] Disconnected. Done.');
}

run().catch(err => {
  console.error('[Audit] Fatal error:', err.message);
  process.exit(1);
});

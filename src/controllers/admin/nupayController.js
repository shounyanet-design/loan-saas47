const asyncHandler = require('express-async-handler');
const nupayService = require('../../services/nupayService');
const LoanApplication = require('../../models/LoanApplication');
const DuePayment = require('../../models/DuePayment');
const ActiveLoan = require('../../models/ActiveLoan');
const idempotency = require('../../services/idempotencyService');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * Map idempotency-control errors to the right HTTP semantics so a duplicate /
 * in-flight financial request is rejected safely instead of executing twice.
 */
function handleFinancialError(res, err, fallback) {
  if (err && err.name === 'IdempotencyInProgressError') {
    if (err.retryAfterMs) res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
    return sendError(res, err.message, 409);
  }
  if (err && err.name === 'IdempotencyConflictError') {
    return sendError(res, err.message, 422);
  }
  return sendError(res, (err && err.message) || fallback, 500);
}

const initiateDebiCheckMandate = asyncHandler(async (req, res) => {
  const { applicationId } = req.body;
  const loanApp = await LoanApplication.findById(applicationId);
  if (!loanApp) {
    return sendError(res, 'Loan application not found', 404);
  }

  // Idempotency: client may supply an Idempotency-Key header; otherwise we
  // derive a deterministic key so a retry/double-click cannot create a second
  // mandate for the same application.
  const key = req.headers['idempotency-key']
    || idempotency.buildKey('nupay', 'initiateMandate', applicationId);

  try {
    const { response: result } = await idempotency.runOnce(
      { key, scope: 'nupay', action: 'initiateMandate', tenantId: loanApp.tenantId, request: { applicationId } },
      () => nupayService.initiateMandate(loanApp)
    );

    // Save mandate details to application
    loanApp.debicheckMandateStatus = result.status || 'Pending Authentication';
    loanApp.debicheckMandateReference = result.reference;
    await loanApp.save();

    sendSuccess(res, 'DebiCheck mandate initiated successfully', {
      status: loanApp.debicheckMandateStatus,
      reference: loanApp.debicheckMandateReference,
      message: result.message
    });
  } catch (err) {
    handleFinancialError(res, err, 'Failed to initiate DebiCheck mandate');
  }
});

const rescheduleNuPayInstalment = asyncHandler(async (req, res) => {
  const { duePaymentId, submitDate, trackingIndicator } = req.body;
  const duePayment = await DuePayment.findById(duePaymentId);
  if (!duePayment) {
    return sendError(res, 'Due payment record not found', 404);
  }

  const key = req.headers['idempotency-key']
    || idempotency.buildKey('nupay', 'rescheduleInstalment', duePaymentId, submitDate);

  try {
    const { response: result } = await idempotency.runOnce(
      { key, scope: 'nupay', action: 'rescheduleInstalment', tenantId: duePayment.tenantId, request: { duePaymentId, submitDate, trackingIndicator } },
      () => nupayService.rescheduleInstalment({
        contractReference: duePayment.loanCode,
        submitDate,
        trackingIndicator
      })
    );

    // 1. Update the ActiveLoan schedule item due date so the sync doesn't overwrite it
    const loan = await ActiveLoan.findById(duePayment.loanId);
    if (loan) {
      const inst = loan.repaymentSchedule.find(i => i.installmentNumber === duePayment.installmentNumber);
      if (inst) {
        inst.dueDate = new Date(submitDate);
        inst.paymentStatus = 'Pending'; // Reset to pending if it was overdue
        await loan.save();
      }
    }

    // 2. Update the DuePayment record
    duePayment.dueStatus = 'Rescheduled';
    duePayment.dueDate = new Date(submitDate);
    duePayment.overdueDays = 0; // Reset overdue days
    await duePayment.save();

    sendSuccess(res, 'Instalment rescheduled successfully via NuPay', { result });
  } catch (err) {
    handleFinancialError(res, err, 'Failed to reschedule instalment');
  }
});

const maintainNuPayInstalment = asyncHandler(async (req, res) => {
  const { duePaymentId, amount, trackingDays, applyToAll } = req.body;
  const duePayment = await DuePayment.findById(duePaymentId);
  if (!duePayment) {
    return sendError(res, 'Due payment record not found', 404);
  }

  const key = req.headers['idempotency-key']
    || idempotency.buildKey('nupay', 'maintainInstalment', duePaymentId, amount);

  try {
    const { response: result } = await idempotency.runOnce(
      { key, scope: 'nupay', action: 'maintainInstalment', tenantId: duePayment.tenantId, request: { duePaymentId, amount, trackingDays, applyToAll } },
      () => nupayService.maintainInstalment({
        contractReference: duePayment.loanCode,
        instalmentAmount: amount,
        trackingDays,
        applyToAll
      })
    );

    duePayment.emiAmount = amount;
    duePayment.totalDueAmount = amount + (duePayment.penaltyAmount || 0);
    await duePayment.save();

    sendSuccess(res, 'Instalment details maintained successfully via NuPay', { result });
  } catch (err) {
    handleFinancialError(res, err, 'Failed to maintain instalment details');
  }
});

const cancelNuPayInstalment = asyncHandler(async (req, res) => {
  const { duePaymentId } = req.body;
  const duePayment = await DuePayment.findById(duePaymentId);
  if (!duePayment) {
    return sendError(res, 'Due payment record not found', 404);
  }

  const key = req.headers['idempotency-key']
    || idempotency.buildKey('nupay', 'cancelInstalment', duePaymentId);

  try {
    const { response: result } = await idempotency.runOnce(
      { key, scope: 'nupay', action: 'cancelInstalment', tenantId: duePayment.tenantId, request: { duePaymentId } },
      () => nupayService.cancelInstalment({ contractReference: duePayment.loanCode })
    );

    duePayment.dueStatus = 'Cancelled';
    await duePayment.save();

    sendSuccess(res, 'Instalment cancelled successfully via NuPay', { result });
  } catch (err) {
    handleFinancialError(res, err, 'Failed to cancel instalment');
  }
});

const recallNuPayInstalment = asyncHandler(async (req, res) => {
  const { duePaymentId } = req.body;
  const duePayment = await DuePayment.findById(duePaymentId);
  if (!duePayment) {
    return sendError(res, 'Due payment record not found', 404);
  }

  const key = req.headers['idempotency-key']
    || idempotency.buildKey('nupay', 'recallInstalment', duePaymentId);

  try {
    const { response: result } = await idempotency.runOnce(
      { key, scope: 'nupay', action: 'recallInstalment', tenantId: duePayment.tenantId, request: { duePaymentId } },
      () => nupayService.recallInstalment({ contractReference: duePayment.loanCode })
    );

    duePayment.dueStatus = 'Recalled';
    await duePayment.save();

    sendSuccess(res, 'Instalment recalled successfully via NuPay', { result });
  } catch (err) {
    handleFinancialError(res, err, 'Failed to recall instalment');
  }
});

module.exports = {
  initiateDebiCheckMandate,
  rescheduleNuPayInstalment,
  maintainNuPayInstalment,
  cancelNuPayInstalment,
  recallNuPayInstalment
};

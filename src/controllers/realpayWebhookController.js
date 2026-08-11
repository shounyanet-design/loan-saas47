const asyncHandler = require('express-async-handler');
const LoanApplication = require('../models/LoanApplication');
const tenantContext = require('../tenancy/tenantContext');
const { audit } = require('../modules/saas/utils/auditAny');

/**
 * RealPay Public Webhook Handler
 * Endpoint: POST /api/v1/realpay/webhook
 */
const handleRealPayWebhook = asyncHandler(async (req, res) => {
  const payload = req.body || {};

  if (process.env.NODE_ENV !== 'test') {
    console.log('[RealPay Webhook Event Received]', {
      reference: payload.clientReference || payload.mandateId || payload.providerReference,
      status: payload.status || payload.statusCode,
      timestamp: new Date().toISOString()
    });
  }

  const mandateId = String(payload.mandateId || payload.providerReference || payload.reference || '').trim();
  const clientRef = String(payload.clientReference || payload.contractReference || '').trim();
  const statusCode = String(payload.statusCode || payload.code || payload.status || '').trim();
  const statusDesc = String(payload.statusDescription || payload.message || payload.description || 'Webhook notification').trim();

  let outcome = 'ACCEPTED';
  if (['REJECTED', 'FAILED', 'CANCELLED', '900002'].includes(statusCode.toUpperCase())) {
    outcome = 'REJECTED';
  } else if (['PENDING', 'AUTH_PENDING', '900001'].includes(statusCode.toUpperCase())) {
    outcome = 'PENDING';
  }

  const updatedLoan = await tenantContext.runAsSystem(async () => {
    const query = [];
    if (mandateId) {
      query.push({ 'realPayMandate.mandateId': mandateId });
      query.push({ 'realPayMandate.providerReference': mandateId });
      query.push({ debicheckMandateReference: mandateId });
    }
    if (clientRef) {
      query.push({ applicationId: clientRef });
      query.push({ 'realPayMandate.clientReference': clientRef });
      query.push({ 'realPayMandate.contractReference': clientRef });
    }

    if (query.length === 0) return null;

    const matchedLoan = await LoanApplication.findOne({ $or: query });
    if (!matchedLoan) return null;

    const existingRealPay = matchedLoan.realPayMandate?.toObject?.() || matchedLoan.realPayMandate || {};

    matchedLoan.debicheckMandateStatus = outcome;
    matchedLoan.debicheckMandateReference = mandateId || matchedLoan.debicheckMandateReference;

    matchedLoan.realPayMandate = {
      ...existingRealPay,
      providerReference: mandateId || existingRealPay.providerReference,
      mandateId: mandateId || existingRealPay.mandateId,
      status: outcome,
      statusCode,
      statusDescription: statusDesc,
      product: payload.product || existingRealPay.product || 'ABSADC',
      clientReference: clientRef || existingRealPay.clientReference,
      contractReference: payload.contractReference || existingRealPay.contractReference,
      updatedAt: new Date(),
      lastWebhookAt: new Date()
    };

    await matchedLoan.save();
    return matchedLoan;
  });

  if (!updatedLoan) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook processed; matching loan application reference not found',
      data: { clientReference: clientRef, mandateId, statusCode }
    });
  }

  return res.status(200).json({
    success: true,
    message: 'RealPay webhook received and processed successfully',
    data: {
      loanApplicationId: updatedLoan._id,
      applicationId: updatedLoan.applicationId,
      mandateId,
      status: outcome
    }
  });
});

module.exports = {
  handleRealPayWebhook
};

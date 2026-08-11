const asyncHandler = require('express-async-handler');
const LoanApplication = require('../models/LoanApplication');
const tenantContext = require('../tenancy/tenantContext');
const { realpayWebhookSchema } = require('../utils/realpayValidation');

/**
 * RealPay Public Webhook Handler
 * Endpoint: POST /api/v1/realpay/webhook
 */
const handleRealPayWebhook = asyncHandler(async (req, res) => {
  const { value, error } = realpayWebhookSchema.validate(req.body || {}, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    return res.status(400).json({
      success: false,
      code: 'REALPAY_VALIDATION_ERROR',
      message: 'Invalid RealPay webhook callback payload',
      errors: error.details.map((item) => ({
        field: item.path.join('.') || 'payload',
        message: item.message
      }))
    });
  }

  const payload = value;
  const mandateId = String(payload.mandateId || payload.providerReference || payload.reference || '').trim();
  const clientRef = String(payload.clientReference || payload.contractReference || '').trim();
  const statusCode = String(payload.statusCode || payload.code || payload.status || '').trim();
  const statusDesc = String(payload.statusDescription || payload.message || payload.description || 'Webhook notification').trim();

  // Sanitized logging (No account/bank numbers or PII logged)
  if (process.env.NODE_ENV !== 'test') {
    console.log('[RealPay Webhook Event Received]', {
      clientReference: clientRef ? `${clientRef.substring(0, 8)}...` : '',
      mandateId: mandateId ? `${mandateId.substring(0, 10)}...` : '',
      statusCode,
      timestamp: new Date().toISOString()
    });
  }

  let outcome = 'ACCEPTED';
  if (['REJECTED', 'FAILED', 'CANCELLED', '900002'].includes(statusCode.toUpperCase())) {
    outcome = 'REJECTED';
  } else if (['PENDING', 'AUTH_PENDING', '900001'].includes(statusCode.toUpperCase())) {
    outcome = 'PENDING';
  }

  const result = await tenantContext.runAsSystem(async () => {
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

    // Idempotency check: if status & statusCode match and updated recently (no state change required)
    const isDuplicate = existingRealPay.status === outcome && existingRealPay.statusCode === statusCode && existingRealPay.lastWebhookAt;
    if (isDuplicate) {
      return { matchedLoan, isDuplicate: true };
    }

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
    return { matchedLoan, isDuplicate: false };
  });

  if (!result || !result.matchedLoan) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook acknowledged; matching loan application reference not found',
      data: { clientReference: clientRef, mandateId, statusCode }
    });
  }

  if (result.isDuplicate) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook callback already processed (idempotent)',
      data: {
        loanApplicationId: result.matchedLoan._id,
        applicationId: result.matchedLoan.applicationId,
        mandateId,
        status: outcome,
        replayed: true
      }
    });
  }

  return res.status(200).json({
    success: true,
    message: 'RealPay webhook received and processed successfully',
    data: {
      loanApplicationId: result.matchedLoan._id,
      applicationId: result.matchedLoan.applicationId,
      mandateId,
      status: outcome
    }
  });
});

module.exports = {
  handleRealPayWebhook
};

const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const LoanApplication = require('../models/LoanApplication');
const tenantContext = require('../tenancy/tenantContext');
const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../utils/realpayValidation');

function verifyHmacSignature(req, hmacSecret) {
  if (!hmacSecret) return true;

  const headerSig = req.headers['x-realpay-hmac']
    || req.headers['x-signature']
    || req.headers['x-hmac-sha256']
    || req.headers['x-hub-signature-256']
    || req.headers['x-realpay-signature'];

  if (!headerSig) return false;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const computedHex = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');
  const computedBase64 = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('base64');

  const cleanHeader = String(headerSig).replace(/^sha256=/i, '').trim();

  const bufHeader = Buffer.from(cleanHeader);
  const bufHex = Buffer.from(computedHex);
  const bufBase64 = Buffer.from(computedBase64);

  let matchHex = false;
  if (bufHeader.length === bufHex.length) {
    matchHex = crypto.timingSafeEqual(bufHeader, bufHex);
  }
  let matchBase64 = false;
  if (bufHeader.length === bufBase64.length) {
    matchBase64 = crypto.timingSafeEqual(bufHeader, bufBase64);
  }

  return matchHex || matchBase64;
}

/**
 * RealPay Public Webhook Handler
 * Endpoint: POST /api/v1/realpay/webhook
 */
const handleRealPayWebhook = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    const receivedTopLevelKeys = Object.keys(req.body || {});
    const signatureHeaderName = ['x-realpay-hmac', 'x-signature', 'x-hmac-sha256', 'x-hub-signature-256', 'x-realpay-signature']
      .find(h => req.headers[h]);

    console.log('[RealPay Webhook Diagnostic]', {
      contentType: req.headers['content-type'] || '',
      bodyType: Array.isArray(req.body) ? 'array' : typeof req.body,
      bodyKeys: receivedTopLevelKeys,
      hasBody: Boolean(req.body && Object.keys(req.body).length > 0),
      hasSignatureHeader: Boolean(signatureHeaderName),
      signatureHeaderName: signatureHeaderName || 'none',
      referenceFieldNamesPresent: receivedTopLevelKeys.filter(k => /contract|client|mandate|ref/i.test(k)),
      statusFieldNamesPresent: receivedTopLevelKeys.filter(k => /status|code|result/i.test(k))
    });
  }

  const hmacSecret = process.env.REALPAY_CALLBACK_HMAC;
  if (hmacSecret && !verifyHmacSignature(req, hmacSecret)) {
    return res.status(401).json({
      success: false,
      code: 'REALPAY_HMAC_INVALID',
      message: 'Invalid or missing RealPay callback HMAC signature'
    });
  }

  const { error } = realpayWebhookSchema.validate(req.body || {}, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[RealPay Webhook Validation Rejection]', {
        validationStage: 'Joi Schema',
        missingFields: error.details.map(d => d.message),
        receivedTopLevelKeys: Object.keys(req.body || {})
      });
    }
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

  const extracted = extractRealPayCallbackFields(req.body || {});
  const { contractSeq, clientRef, mandateId, contractRef, status: rawStatusCode, description: statusDesc } = extracted;

  if (process.env.NODE_ENV !== 'test') {
    console.log('[RealPay Webhook Event Received]', {
      contractSequence: contractSeq ? `${contractSeq.substring(0, 8)}...` : '',
      clientReference: clientRef ? `${clientRef.substring(0, 8)}...` : '',
      mandateId: mandateId ? `${mandateId.substring(0, 10)}...` : '',
      rawStatusCode,
      timestamp: new Date().toISOString()
    });
  }

  let outcome = 'ACCEPTED';
  const cleanStatus = rawStatusCode.toUpperCase();
  if (['REJECTED', 'FAILED', 'CANCELLED', 'F', 'R', 'AREJ', 'FAIL', '900002'].includes(cleanStatus)) {
    outcome = 'REJECTED';
  } else if (['PENDING', 'AUTH_PENDING', 'P', 'APEN', 'PEND', '900001'].includes(cleanStatus)) {
    outcome = 'PENDING';
  } else if (['ACCEPTED', 'SUCCESS', 'SUCC', 'S', '00', 'AAUT'].includes(cleanStatus)) {
    outcome = 'ACCEPTED';
  }

  const result = await tenantContext.runAsSystem(async () => {
    const query = [];
    if (contractSeq) {
      query.push({ 'realPayMandate.contractSequence': contractSeq });
      if (!isNaN(contractSeq)) {
        query.push({ 'realPayMandate.contractSequence': Number(contractSeq) });
      }
    }
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
    if (contractRef) {
      query.push({ 'realPayMandate.contractReference': contractRef });
    }

    if (query.length === 0) return null;

    const matchedLoan = await LoanApplication.findOne({ $or: query });
    if (!matchedLoan) return null;

    const existingRealPay = matchedLoan.realPayMandate?.toObject?.() || matchedLoan.realPayMandate || {};

    const isDuplicate = existingRealPay.status === outcome &&
                        existingRealPay.statusCode === rawStatusCode &&
                        existingRealPay.lastWebhookAt;
    if (isDuplicate) {
      return { matchedLoan, isDuplicate: true };
    }

    matchedLoan.debicheckMandateStatus = outcome;
    if (mandateId) {
      matchedLoan.debicheckMandateReference = mandateId;
    }

    matchedLoan.realPaySimulation = matchedLoan.realPaySimulation || {};
    matchedLoan.realPaySimulation.environment = 'UAT';
    matchedLoan.realPaySimulation.mandate = {
      contractSequence: contractSeq || existingRealPay.contractSequence || '',
      requestedAt: matchedLoan.realPaySimulation?.mandate?.requestedAt || new Date(),
      completedAt: new Date(),
      statusCode: rawStatusCode,
      result: outcome,
      providerStatus: rawStatusCode,
      providerMessage: statusDesc
    };

    matchedLoan.realPayMandate = {
      ...existingRealPay,
      providerReference: mandateId || existingRealPay.providerReference,
      mandateId: mandateId || existingRealPay.mandateId,
      contractSequence: contractSeq || existingRealPay.contractSequence,
      status: outcome,
      statusCode: rawStatusCode,
      statusDescription: statusDesc,
      product: extracted.payload.product || extracted.payload.Product || existingRealPay.product || 'ABSADC',
      clientReference: clientRef || existingRealPay.clientReference,
      contractReference: contractRef || existingRealPay.contractReference,
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
      data: { contractSequence: contractSeq, clientReference: clientRef, mandateId, statusCode: rawStatusCode }
    });
  }

  if (result.isDuplicate) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook callback already processed (idempotent)',
      data: {
        loanApplicationId: result.matchedLoan._id,
        applicationId: result.matchedLoan.applicationId,
        contractSequence: result.matchedLoan.realPayMandate?.contractSequence,
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
      contractSequence: result.matchedLoan.realPayMandate?.contractSequence,
      mandateId,
      status: outcome
    }
  });
});

module.exports = {
  handleRealPayWebhook
};

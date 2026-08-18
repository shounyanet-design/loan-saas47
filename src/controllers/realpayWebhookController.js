const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const LoanApplication = require('../models/LoanApplication');
const tenantContext = require('../tenancy/tenantContext');
const { realpayWebhookSchema, extractRealPayCallbackFields } = require('../utils/realpayValidation');

function verifyHmacSignature(req, hmacSecret) {
  const isRequired = Boolean(hmacSecret) || process.env.REALPAY_CALLBACK_HMAC_REQUIRED === 'true' || process.env.NODE_ENV === 'production';
  if (!isRequired) return true;
  if (!hmacSecret) return false;

  const headerSig = req.headers['x-realpay-hmac']
    || req.headers['x-signature']
    || req.headers['x-hmac-sha256']
    || req.headers['x-hub-signature-256']
    || req.headers['x-realpay-signature'];

  if (!headerSig) return false;

  const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
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
  const extracted = extractRealPayCallbackFields(req.body || {});
  const { callbackType, contractSeq, instalmentSeq, clientRef, mandateId, contractRef, status: rawStatusCode, description: statusDesc } = extracted;

  if (process.env.NODE_ENV !== 'test') {
    const receivedTopLevelKeys = Object.keys(req.body || {});
    const signatureHeaderName = ['x-realpay-hmac', 'x-signature', 'x-hmac-sha256', 'x-hub-signature-256', 'x-realpay-signature']
      .find(h => req.headers[h]);

    console.log('[RealPay Webhook Diagnostic]', {
      callbackType,
      contentType: req.headers['content-type'] || '',
      bodyType: Array.isArray(req.body) ? 'array' : typeof req.body,
      bodyKeys: receivedTopLevelKeys,
      hasBody: Boolean(req.body && Object.keys(req.body).length > 0),
      hasContractSequence: Boolean(contractSeq),
      hasInstalmentSequence: Boolean(instalmentSeq),
      hasStatus: Boolean(rawStatusCode),
      hasSignatureHeader: Boolean(signatureHeaderName),
      signatureHeaderName: signatureHeaderName || 'none'
    });
  }

  const hmacSecret = process.env.REALPAY_CALLBACK_HMAC;
  if (!verifyHmacSignature(req, hmacSecret)) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[RealPay Webhook Security Rejection]', {
        reason: 'HMAC signature verification failed or signature header missing',
        hasSecret: Boolean(hmacSecret)
      });
    }
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

  if (process.env.NODE_ENV !== 'test') {
    console.log('[RealPay Webhook Event Received]', {
      callbackType,
      contractSequence: contractSeq ? `${contractSeq.substring(0, 8)}...` : '',
      instalmentSequence: instalmentSeq || '',
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
    matchedLoan.realPaySimulation = matchedLoan.realPaySimulation || {};
    matchedLoan.realPaySimulation.environment = 'UAT';

    if (callbackType === 'INSTALMENT') {
      const existingInst = matchedLoan.realPaySimulation?.instalment || {};
      const isDuplicate = existingInst.statusCode === rawStatusCode &&
                          String(existingInst.instalmentSequence || '') === String(instalmentSeq || '') &&
                          existingInst.completedAt;

      if (isDuplicate) {
        return { matchedLoan, isDuplicate: true };
      }

      const $setObj = {
        'realPaySimulation.environment': 'UAT',
        'realPaySimulation.instalment.requestedAt': existingInst.requestedAt || new Date(),
        'realPaySimulation.instalment.completedAt': new Date(),
        'realPaySimulation.instalment.statusCode': rawStatusCode,
        'realPaySimulation.instalment.result': outcome,
        'realPaySimulation.instalment.providerStatus': rawStatusCode,
        'realPaySimulation.instalment.providerMessage': statusDesc,
        'realPayMandate.updatedAt': new Date(),
        'realPayMandate.lastWebhookAt': new Date()
      };

      if (contractSeq) {
        $setObj['realPaySimulation.instalment.contractSequence'] = contractSeq;
        $setObj['realPayMandate.contractSequence'] = contractSeq;
      }

      // CRITICAL RULE: Never overwrite existing sequence with empty string/null
      if (instalmentSeq) {
        $setObj['realPaySimulation.instalment.instalmentSequence'] = instalmentSeq;
        $setObj['realPayMandate.instalmentSequence'] = instalmentSeq;
      }

      const updatedLoan = await LoanApplication.findOneAndUpdate(
        { _id: matchedLoan._id },
        { $set: $setObj },
        { returnDocument: 'after' }
      );

      return { matchedLoan: updatedLoan, isDuplicate: false };
    }

    // Default / MANDATE callback processing
    const isDuplicate = existingRealPay.status === outcome &&
                        existingRealPay.statusCode === rawStatusCode &&
                        existingRealPay.lastWebhookAt;
    if (isDuplicate) {
      return { matchedLoan, isDuplicate: true };
    }

    const $setObj = {
      debicheckMandateStatus: outcome,
      'realPaySimulation.environment': 'UAT',
      'realPaySimulation.mandate.requestedAt': matchedLoan.realPaySimulation?.mandate?.requestedAt || new Date(),
      'realPaySimulation.mandate.completedAt': new Date(),
      'realPaySimulation.mandate.statusCode': rawStatusCode,
      'realPaySimulation.mandate.result': outcome,
      'realPaySimulation.mandate.providerStatus': rawStatusCode,
      'realPaySimulation.mandate.providerMessage': statusDesc,

      'realPayMandate.status': outcome,
      'realPayMandate.statusCode': rawStatusCode,
      'realPayMandate.statusDescription': statusDesc,
      'realPayMandate.product': extracted.payload.product || extracted.payload.Product || existingRealPay.product || 'ABSADC',
      'realPayMandate.updatedAt': new Date(),
      'realPayMandate.lastWebhookAt': new Date()
    };

    if (mandateId) {
      $setObj.debicheckMandateReference = mandateId;
      $setObj['realPayMandate.providerReference'] = mandateId;
      $setObj['realPayMandate.mandateId'] = mandateId;
    }
    if (contractSeq) {
      $setObj['realPaySimulation.mandate.contractSequence'] = contractSeq;
      $setObj['realPayMandate.contractSequence'] = contractSeq;
    }
    if (clientRef) {
      $setObj['realPayMandate.clientReference'] = clientRef;
    }
    if (contractRef) {
      $setObj['realPayMandate.contractReference'] = contractRef;
    }
    // CRITICAL RULE: Only set instalmentSequence if non-empty!
    if (instalmentSeq) {
      $setObj['realPayMandate.instalmentSequence'] = instalmentSeq;
    }

    const updatedLoan = await LoanApplication.findOneAndUpdate(
      { _id: matchedLoan._id },
      { $set: $setObj },
      { new: true }
    );

    return { matchedLoan: updatedLoan, isDuplicate: false };
  });

  if (!result || !result.matchedLoan) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook acknowledged; matching loan application reference not found',
      data: { callbackType, contractSequence: contractSeq, instalmentSequence: instalmentSeq, clientReference: clientRef, mandateId, statusCode: rawStatusCode }
    });
  }

  if (result.isDuplicate) {
    return res.status(200).json({
      success: true,
      message: 'RealPay webhook callback already processed (idempotent)',
      data: {
        loanApplicationId: result.matchedLoan._id,
        applicationId: result.matchedLoan.applicationId,
        callbackType,
        contractSequence: result.matchedLoan.realPayMandate?.contractSequence,
        instalmentSequence: result.matchedLoan.realPayMandate?.instalmentSequence,
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
      callbackType,
      contractSequence: result.matchedLoan.realPayMandate?.contractSequence,
      instalmentSequence: result.matchedLoan.realPayMandate?.instalmentSequence,
      mandateId,
      status: outcome
    }
  });
});

module.exports = {
  handleRealPayWebhook
};

const asyncHandler = require('express-async-handler');
const nupayService = require('../../services/nupayService');
const LoanApplication = require('../../models/LoanApplication');
const idempotency = require('../../services/idempotencyService');
const {
  mandateInitiationSchema,
  tt1RegistrationSchema,
  mandateReportSchema,
  instalmentReportSchema
} = require('../../utils/nupayValidation');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { NuPayError } = require('../../errors/nupayErrors');

function validate(schema, value) {
  const result = schema.validate(value, { abortEarly: false, stripUnknown: false });
  if (result.error) {
    const error = new Error(result.error.details.map((item) => item.message).join(', '));
    error.statusCode = 400;
    error.code = 'NUPAY_VALIDATION_ERROR';
    throw error;
  }
  return result.value;
}

function handleError(res, error) {
  return res.status(error.statusCode || 500).json({
    success: false,
    code: error.code || 'NUPAY_OPERATION_FAILED',
    message: error.message,
    requiresVerification: Boolean(error.requiresVerification)
  });
}

const initiateDebiCheckMandate = asyncHandler(async (req, res) => {
  try {
    const { applicationId, mandate } = req.body;
    if (!applicationId) return sendError(res, 'applicationId is required', 400);

    const loan = await LoanApplication.findOne({ _id: applicationId, tenantId: req.tenantId });
    if (!loan) return sendError(res, 'Loan application not found', 404);

    const payload = validate(mandateInitiationSchema, mandate || {});
    const key = req.headers['idempotency-key']
      || idempotency.buildKey('nupay', String(req.tenantId), 'initiateMandate', applicationId, payload.clientReference);

    const { response: result, replayed } = await idempotency.runOnce(
      {
        key,
        scope: 'nupay',
        action: 'initiateMandate',
        tenantId: req.tenantId,
        request: { applicationId, mandate: payload }
      },
      () => nupayService.initiateMandate(payload, req.tenantId)
    );

    loan.debicheckMandateStatus = result.outcome;
    loan.debicheckMandateReference = result.mandateId || result.contractReference || '';
    loan.nupayMandate = {
      outcome: result.outcome,
      providerStatus: result.providerStatus,
      resultCode: result.resultCode,
      mandateId: result.mandateId,
      clientReference: result.clientReference,
      contractReference: result.contractReference,
      providerTransactionId: result.providerTransactionId,
      providerMessageId: result.providerMessageId,
      effectiveDate: result.effectiveDate,
      updatedAt: new Date()
    };
    await loan.save();

    return sendSuccess(
      res,
      result.outcome === 'ACCEPTED'
        ? 'DebiCheck mandate accepted'
        : result.outcome === 'PENDING'
          ? 'DebiCheck mandate is pending authentication'
          : 'DebiCheck mandate response received',
      { ...result, replayed },
      result.outcome === 'PENDING' ? 202 : 200
    );
  } catch (error) {
    return handleError(res, error);
  }
});

const registerTT1Endpoint = asyncHandler(async (req, res) => {
  try {
    const rawBody = {
      endpointUrl: req.body?.endpointUrl || process.env.NUPAY_TT1_CALLBACK_URL,
      registrationStatus: req.body?.registrationStatus || 'Register',
      cardAcceptorEmail: req.body?.cardAcceptorEmail || process.env.NUPAY_CARD_ACCEPTOR_EMAIL
    };
    const payload = validate(tt1RegistrationSchema, rawBody);
    const result = await nupayService.registerTT1Endpoint(payload, req.tenantId);
    return sendSuccess(res, 'TT1 endpoint registration response received', result);
  } catch (error) {
    return handleError(res, error);
  }
});

const getMandateReport = asyncHandler(async (req, res) => {
  try {
    const payload = validate(mandateReportSchema, req.body);
    const result = await nupayService.getMandateReport(payload, req.tenantId);
    return sendSuccess(res, 'Mandate report retrieved', result);
  } catch (error) {
    return handleError(res, error);
  }
});

const getInstalmentReport = asyncHandler(async (req, res) => {
  try {
    const payload = validate(instalmentReportSchema, req.body);
    const result = await nupayService.getInstalmentReport(payload, req.tenantId);
    return sendSuccess(res, 'Instalment report retrieved', result);
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = {
  initiateDebiCheckMandate,
  registerTT1Endpoint,
  getMandateReport,
  getInstalmentReport
};

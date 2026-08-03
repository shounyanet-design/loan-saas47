const asyncHandler = require('express-async-handler');
const crypto = require('crypto');

const LoanApplication = require('../models/LoanApplication');
const { tt1CallbackSchema } = require('../utils/nupayValidation');
const tenantContext = require('../tenancy/tenantContext');

/**
 * Safely compare callback secrets without exposing timing differences.
 */
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Convert NuPay result code into the internal mandate status.
 */
function getMandateOutcome(resultCode) {
  if (resultCode === '900000') {
    return 'ACCEPTED';
  }

  if (resultCode === '900001') {
    return 'PENDING';
  }

  return 'REJECTED';
}

/**
 * NuPay TT1 callback handler.
 *
 * This endpoint is public because NuPay calls it directly and therefore
 * it does not have the tenant context that normal authenticated requests use.
 * The database lookup must run in trusted system mode.
 */
const handleTT1Callback = asyncHandler(async (req, res) => {
  const configuredSecret = process.env.NUPAY_TT1_CALLBACK_SECRET;

  if (
    configuredSecret &&
    !safeEqual(
      req.headers['x-nupay-callback-secret'],
      configuredSecret
    )
  ) {
    return res.status(401).json({
      success: false,
      message: 'Invalid callback credential'
    });
  }

  const { value, error } = tt1CallbackSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid NuPay TT1 callback payload',
      errors: error.details.map((item) => ({
        field: item.path.join('.'),
        message: item.message
      }))
    });
  }

  const resultCode = String(value.statusCode || '')
    .replace(/\s+/g, '')
    .trim();

  const outcome = getMandateOutcome(resultCode);

  const updatedLoan = await tenantContext.runAsSystem(async () => {
    const matchedLoan = await LoanApplication.findOne({
      $or: [
        {
          'nupayMandate.mandateId': value.mandateId
        },
        {
          'nupayMandate.contractReference':
            value.contractReference
        },
        {
          debicheckMandateReference: value.mandateId
        }
      ]
    });

    if (!matchedLoan) {
      return null;
    }

    const existingMandate =
      matchedLoan.nupayMandate?.toObject?.() ||
      matchedLoan.nupayMandate ||
      {};

    matchedLoan.debicheckMandateStatus = outcome;
    matchedLoan.debicheckMandateReference = value.mandateId;

    matchedLoan.nupayMandate = {
      ...existingMandate,

      outcome,
      resultCode,

      mandateId: value.mandateId,
      contractReference: value.contractReference,

      statusCode: resultCode,
      statusDescription: value.statusDescription,

      callbackRequestId: value.requestId,
      callbackClientEndpoint: value.clientEndPointIp,
      callbackSupportEmail: value.supportMail,

      callbackReceivedAt: new Date(),
      updatedAt: new Date(),

      lastCallbackPayload: value
    };

    await matchedLoan.save();

    return matchedLoan;
  });

  /*
   * Unknown references should not cause NuPay to receive a 500 response.
   * Returning 202 confirms that the callback was received safely even
   * though no matching loan application was found.
   */
  if (!updatedLoan) {
    return res.status(202).json({
      success: true,
      message: 'Callback accepted; matching mandate was not found',
      data: {
        requestId: value.requestId,
        mandateId: value.mandateId,
        contractReference: value.contractReference,
        statusCode: resultCode
      }
    });
  }

  return res.status(200).json({
    success: true,
    message: 'NuPay TT1 callback received and processed',
    data: {
      loanApplicationId: updatedLoan._id,
      mandateId: value.mandateId,
      contractReference: value.contractReference,
      statusCode: resultCode,
      outcome
    }
  });
});

module.exports = {
  handleTT1Callback
};
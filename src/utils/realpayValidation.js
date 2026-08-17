const Joi = require('joi');

/**
 * Helper to extract reference, status, and description from raw RealPay callback body
 */
function extractRealPayCallbackFields(body = {}) {
  let payload = body;
  if (Array.isArray(body)) {
    payload = body[0] || {};
  } else if (body.MandateSimulatePutResponse?.[0]) {
    payload = body.MandateSimulatePutResponse[0];
  } else if (body.InstalmentSimulatePutResponse?.[0]) {
    payload = body.InstalmentSimulatePutResponse[0];
  } else if (body.MandatePostResponse?.[0]) {
    payload = body.MandatePostResponse[0];
  }

  if (payload.Successful?.[0]) {
    payload = { ...payload, ...payload.Successful[0] };
  } else if (payload.Failed?.[0]) {
    payload = { ...payload, ...payload.Failed[0] };
  }

  const contractSeq = payload.ContractSequence ?? payload.contractSequence;
  const clientRef = payload.ClientNumber ?? payload.clientNumber ?? payload.ClientReference ?? payload.clientReference ?? payload.applicationId;
  const mandateId = payload.MandateId ?? payload.mandateId ?? payload.ProviderReference ?? payload.providerReference ?? payload.ContractNumber ?? payload.contractNumber;
  const contractRef = payload.ContractReference ?? payload.contractReference;

  const ref = contractSeq ?? clientRef ?? mandateId ?? contractRef;

  const status = payload.MandateInitiateStatusCode ?? payload.mandateInitiateStatusCode ??
                 payload.MandateInitiateResult ?? payload.mandateInitiateResult ??
                 payload.InstalmentStatusCode ?? payload.instalmentStatusCode ??
                 payload.InstalmentResult ?? payload.instalmentResult ??
                 payload.StatusCode ?? payload.statusCode ??
                 payload.Status ?? payload.status ??
                 payload.Code ?? payload.code ??
                 payload.ResultCode ?? payload.resultCode ??
                 payload.Result ?? payload.result;

  const description = payload.StatusDescription ?? payload.statusDescription ??
                      payload.FailureDescription ?? payload.failureDescription ??
                      payload.Message ?? payload.message ??
                      payload.Description ?? payload.description ??
                      'RealPay webhook notification';

  return {
    payload,
    contractSeq: contractSeq != null ? String(contractSeq).trim() : '',
    clientRef: clientRef != null ? String(clientRef).trim() : '',
    mandateId: mandateId != null ? String(mandateId).trim() : '',
    contractRef: contractRef != null ? String(contractRef).trim() : '',
    ref: ref != null ? String(ref).trim() : '',
    status: status != null ? String(status).trim() : '',
    description: String(description).trim()
  };
}

/**
 * Validation schema for RealPay Webhook callbacks.
 * Supports PascalCase and camelCase keys from official RealPay callbacks.
 */
const realpayWebhookSchema = Joi.object().unknown(true).custom((value, helpers) => {
  const extracted = extractRealPayCallbackFields(value);

  if (!extracted.ref) {
    return helpers.message('Webhook callback payload must contain a valid ContractSequence, ClientNumber, or MandateId');
  }

  if (!extracted.status) {
    return helpers.message('Webhook callback payload must contain a valid MandateInitiateStatusCode, StatusCode, or Status');
  }

  return value;
}, 'RealPay Webhook validation');

module.exports = {
  realpayWebhookSchema,
  extractRealPayCallbackFields
};

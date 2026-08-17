const Joi = require('joi');

/**
 * Helper to extract reference, status, and description from raw RealPay callback body
 */
function extractRealPayCallbackFields(body = {}) {
  let callbackType = 'UNKNOWN';
  let payload = body;

  if (Array.isArray(body)) {
    payload = body[0] || {};
  }

  // 1. Unwrap top-level provider wrappers (MandateGetResponse, InstalmentGetResponse, etc.)
  if (payload.MandateGetResponse) {
    callbackType = 'MANDATE';
    payload = Array.isArray(payload.MandateGetResponse) ? (payload.MandateGetResponse[0] || {}) : payload.MandateGetResponse;
  } else if (payload.InstalmentGetResponse) {
    callbackType = 'INSTALMENT';
    payload = Array.isArray(payload.InstalmentGetResponse) ? (payload.InstalmentGetResponse[0] || {}) : payload.InstalmentGetResponse;
  } else if (payload.MandateSimulatePutResponse) {
    callbackType = 'MANDATE';
    payload = Array.isArray(payload.MandateSimulatePutResponse) ? (payload.MandateSimulatePutResponse[0] || {}) : payload.MandateSimulatePutResponse;
  } else if (payload.InstalmentSimulatePutResponse) {
    callbackType = 'INSTALMENT';
    payload = Array.isArray(payload.InstalmentSimulatePutResponse) ? (payload.InstalmentSimulatePutResponse[0] || {}) : payload.InstalmentSimulatePutResponse;
  } else if (payload.MandatePostResponse) {
    callbackType = 'MANDATE';
    payload = Array.isArray(payload.MandatePostResponse) ? (payload.MandatePostResponse[0] || {}) : payload.MandatePostResponse;
  } else if (payload.InstalmentPostResponse) {
    callbackType = 'INSTALMENT';
    payload = Array.isArray(payload.InstalmentPostResponse) ? (payload.InstalmentPostResponse[0] || {}) : payload.InstalmentPostResponse;
  }

  // 2. Unwrap Successful / Failed nested wrappers if present
  if (payload.Successful) {
    const succ = Array.isArray(payload.Successful) ? payload.Successful[0] : payload.Successful;
    if (succ) payload = { ...payload, ...succ };
  } else if (payload.Failed) {
    const fail = Array.isArray(payload.Failed) ? payload.Failed[0] : payload.Failed;
    if (fail) payload = { ...payload, ...fail };
  }

  // 3. Extract ContractSequence & InstalmentSequence
  const rawContractSeq = payload.ContractSequence ?? payload.contractSequence;
  const rawInstalmentSeq = payload.InstalmentSequence ?? payload.instalmentSequence;
  const clientRef = payload.ClientNumber ?? payload.clientNumber ?? payload.ClientReference ?? payload.clientReference ?? payload.applicationId;
  const mandateId = payload.MandateId ?? payload.mandateId ?? payload.ProviderReference ?? payload.providerReference ?? payload.ContractNumber ?? payload.contractNumber;
  const contractRef = payload.ContractReference ?? payload.contractReference;

  const contractSeq = rawContractSeq != null ? String(rawContractSeq).trim() : '';
  const instalmentSeq = rawInstalmentSeq != null ? String(rawInstalmentSeq).trim() : '';

  if (callbackType === 'UNKNOWN') {
    if (instalmentSeq || payload.InstalmentStatus || payload.InstalmentStatusCode || payload.InstalmentResult) {
      callbackType = 'INSTALMENT';
    } else if (contractSeq || payload.MandateInitiateStatusCode || payload.MandateRegisterStatusCode || payload.MandateStatus) {
      callbackType = 'MANDATE';
    }
  }

  const ref = contractSeq || clientRef || mandateId || contractRef;

  const rawStatus = payload.MandateInitiateStatusCode ?? payload.mandateInitiateStatusCode ??
                    payload.MandateRegisterStatusCode ?? payload.mandateRegisterStatusCode ??
                    payload.InstalmentStatusCode ?? payload.instalmentStatusCode ??
                    payload.MandateStatus ?? payload.mandateStatus ??
                    payload.InstalmentStatus ?? payload.instalmentStatus ??
                    payload.StatusCode ?? payload.statusCode ??
                    payload.Status ?? payload.status ??
                    payload.Code ?? payload.code ??
                    payload.ResultCode ?? payload.resultCode ??
                    payload.Result ?? payload.result;

  const rawResult = payload.MandateInitiateResult ?? payload.mandateInitiateResult ??
                    payload.InstalmentResult ?? payload.instalmentResult ??
                    payload.Result ?? payload.result ?? '';

  const description = payload.StatusDescription ?? payload.statusDescription ??
                      payload.FailureDescription ?? payload.failureDescription ??
                      payload.Message ?? payload.message ??
                      payload.Description ?? payload.description ??
                      'RealPay webhook notification';

  return {
    callbackType,
    payload,
    contractSeq,
    instalmentSeq,
    clientRef: clientRef != null ? String(clientRef).trim() : '',
    mandateId: mandateId != null ? String(mandateId).trim() : '',
    contractRef: contractRef != null ? String(contractRef).trim() : '',
    ref: ref != null ? String(ref).trim() : '',
    status: rawStatus != null ? String(rawStatus).trim() : '',
    result: rawResult != null ? String(rawResult).trim() : '',
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

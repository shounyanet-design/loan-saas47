const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/credit/datanamix/consumer-search';

// ─── Response normalizer ──────────────────────────────────────────────────────

const normalizeResponse = (raw) => {
  console.log("RAW CREDIT SEARCH RESPONSE:", JSON.stringify(raw, null, 2));

  const header   = raw.Header          ?? {};
  const consumers = raw.ConsumerDetails ?? [];
  const success   = raw.Success         === true;
  const responseCode = raw.ResponseCode ?? null;

  // Normalize each matched consumer record
  const matchedConsumers = consumers.map((c) => ({
    consumerId:      c.ConsumerID      ?? null,
    firstName:       c.FirstName       ?? null,
    surname:         c.Surname         ?? null,
    idNo:            c.IDNo            ?? null,
    birthDate:       c.BirthDate       ?? null,
    gender:          c.GenderInd       ?? null,
    enquiryId:       c.EnquiryID       ?? null,
    enquiryResultId: c.EnquiryResultID ?? null,
    reference:       c.Reference       ?? null,
  }));

  // Primary enquiry IDs come from the first matched consumer
  const primary = matchedConsumers[0] ?? {};

  // Determine verification status:
  //  success + consumers found  → Verified
  //  success + no consumers     → Warning (no profile on record)
  //  API failure                → Failed
  let verificationStatus;
  if (success && matchedConsumers.length > 0) {
    verificationStatus = 'Verified';
  } else if (success) {
    verificationStatus = 'Warning';
  } else {
    verificationStatus = 'Failed';
  }

  return {
    verificationStatus,
    enquiryId:       primary.enquiryId       ?? null,
    enquiryResultId: primary.enquiryResultId ?? null,
    matchedConsumers,
    reportReference: header.ReportReference ?? null,
    reportDate:      header.SearchDate       ?? null,
    searchSuccess:   success,
    responseCode,
    header,
    rawResponse: raw,
  };
};

// ─── Main caller ──────────────────────────────────────────────────────────────

/**
 * Initiates a Datanamix Consumer Credit Search.
 * Returns EnquiryID and EnquiryResultID needed for the subsequent Result API call.
 *
 * @param {Object} params
 * @param {string}  params.idNumber         - SA ID number
 * @param {string}  [params.passportNumber] - Passport number (optional)
 * @param {string}  [params.reference]      - Client reference (applicationId preferred)
 * @returns {Promise<Object>} Normalized credit search result
 */
const callConsumerCreditSearch = async ({
  idNumber,
  passportNumber = '',
  reference,
}) => {
  if (!idNumber) throw new Error('IdNumber is required for consumer credit search');

  const clientRef = reference || `CREDIT-${Date.now()}`;

  const payload = {
    EnvironmentType: 'SANDBOX',
    EnquiryReason:   'Credit Check',
    IdNumber:        idNumber,
    Reference:       clientRef,
    PassportNumber:  passportNumber,
  };

  console.log("CREDIT SEARCH OUTGOING PAYLOAD:", JSON.stringify(payload, null, 2));

  const response = await datanamixAxiosClient.post(ENDPOINT, payload);
  const normalized = normalizeResponse(response.data);

  console.log(
    `[CREDIT-SEARCH] Status: ${normalized.verificationStatus} | Consumers: ${normalized.matchedConsumers.length} | EnquiryID: ${normalized.enquiryId}`
  );

  return normalized;
};

module.exports = { callConsumerCreditSearch };

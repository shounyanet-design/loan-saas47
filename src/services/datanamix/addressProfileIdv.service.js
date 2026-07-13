const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/kyc/address-plus-profile-idv';

// ─── Deceased detection helper ────────────────────────────────────────────────
// API returns strings like "Yes - 2017-12-01", "Yes", "Y", "NO", "N", or null.
// A non-null HomeAffairsDeceasedDate is also treated as confirmation of death.

const parseDeceasedStatus = (rawStatus, rawDate) => {
  const isYes =
    typeof rawStatus === 'string' && /^yes/i.test(rawStatus.trim());
  const hasDate = rawDate !== null && rawDate !== undefined && rawDate !== '';
  return isYes || hasDate;
};

// Extract date value: prefer dedicated field, otherwise parse from the string
// e.g. "Yes - 2017-12-01" → "2017-12-01"
const parseDeceasedDate = (rawStatus, rawDate) => {
  if (rawDate) return rawDate;
  if (typeof rawStatus === 'string') {
    const match = rawStatus.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }
  return null;
};

// ─── SAFPS detection helper ───────────────────────────────────────────────────
// Guard against "Y", "Yes", "YES", true

const parseSafpsFlag = (raw) =>
  (typeof raw === 'string' && /^(y|yes)/i.test(raw.trim())) || raw === true;

// ─── Response normalizer ──────────────────────────────────────────────────────

const normalizeResponse = (raw) => {
  console.log('[BUREAU] Raw Datanamix Address Plus Profile IDV response:\n', JSON.stringify(raw, null, 2));

  const header  = raw.Header  ?? {};
  const result  = raw.Result  ?? {};
  const detail  = result.ConsumerDetail                  ?? {};
  const fraud   = result.ConsumerFraudIndicatorsSummary  ?? {};
  const history = result.ConsumerAddressHistory          ?? [];

  const responseCode = raw.ResponseCode ?? null;
  const messages     = raw.Messages     ?? [];
  const success      = raw.Success      === true;

  // ── Deceased + SAFPS ────────────────────────────────────────────────────────
  const deceasedStatus = parseDeceasedStatus(
    fraud.HomeAffairsDeceasedStatus,
    fraud.HomeAffairsDeceasedDate
  );
  const deceasedDate = parseDeceasedDate(
    fraud.HomeAffairsDeceasedStatus,
    fraud.HomeAffairsDeceasedDate
  );
  const safpsFlag  = parseSafpsFlag(fraud.SAFPSListingYN);
  const haVerified = parseSafpsFlag(fraud.HomeAffairsVerificationYN);
  const isFatal    = deceasedStatus || safpsFlag;

  // ── Fraud flags list ────────────────────────────────────────────────────────
  const fraudFlags = [];
  if (deceasedStatus) fraudFlags.push('DECEASED');
  if (safpsFlag)      fraudFlags.push('SAFPS_LISTED');

  // ── Verification status ─────────────────────────────────────────────────────
  // Fatal conditions → Rejected; profile found → Verified; success only → Warning; else Failed
  let verificationStatus;
  if (isFatal) {
    verificationStatus = 'Rejected';
  } else if (success && detail.IDNumber) {
    verificationStatus = 'Verified';
  } else if (success) {
    verificationStatus = 'Warning';
  } else {
    verificationStatus = 'Failed';
  }

  // ── Employer detail (may be object or string) ───────────────────────────────
  const employerDetail   = detail.EmployerDetail ?? null;
  const verifiedEmployer =
    typeof employerDetail === 'object' && employerDetail !== null
      ? employerDetail.EmployerName ?? JSON.stringify(employerDetail)
      : employerDetail ?? null;

  // ── Address history ─────────────────────────────────────────────────────────
  const normalizedHistory = history.map((entry) => ({
    addressType:     entry.AddressType     ?? null,
    address:         entry.Address         ?? null,
    subscriberName:  entry.SubscriberName  ?? null,
    createdOnDate:   entry.CreatedOnDate   ?? null,
    lastUpdatedDate: entry.LastUpdatedDate ?? null,
  }));

  return {
    verificationStatus,
    isFatal,
    responseCode,
    responseMessage: messages[0] ?? (isFatal
      ? deceasedStatus ? 'Deceased person detected on record' : 'SAFPS fraud listing detected'
      : success ? 'Bureau profile retrieved' : 'Bureau verification failed'),
    bureauReference: header.ReportReference ?? null,

    verifiedFirstName:          detail.FirstName          ?? null,
    verifiedSurname:            detail.Surname            ?? null,
    verifiedPhone:              detail.CellularNumber     ?? null,
    verifiedEmail:              detail.EmailAddress       ?? null,
    verifiedEmployer,
    verifiedResidentialAddress: detail.ResidentialAddress ?? null,
    verifiedPostalAddress:      detail.PostalAddress      ?? null,

    deceasedStatus,
    deceasedDate,
    safpsFlag,
    haVerified,
    fraudFlags,

    addressHistory: normalizedHistory,
    pdfReport:      raw.PDFReport ?? null,

    header,
    messages,
    success,

    bureauRawResponse: raw,
  };
};

// ─── Comparison engine ────────────────────────────────────────────────────────
//
// Four outcomes per field:
//   matched      — both provided AND equal (fuzzy)
//   mismatch     — both provided AND different
//   unavailable  — borrower provided a value, bureau has no data for it
//   not_provided — bureau has a value, borrower did not enter one
//
// Only "mismatch" entries go into mismatchFlags — the other states are
// informational and must NOT trigger a fraud flag.

const normalizeStr = (str) =>
  (str ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim();

const hasValue = (v) =>
  v !== null && v !== undefined && normalizeStr(v) !== '';

const compareField = (entered, bureau, fuzzyLength = 8) => {
  const enteredOk = hasValue(entered);
  const bureauOk  = hasValue(bureau);

  if (!enteredOk && !bureauOk) return { entered: null, bureau: null,   match: null, status: 'both_empty' };
  if (enteredOk  && !bureauOk) return { entered, bureau: null,          match: null, status: 'unavailable' };
  if (!enteredOk && bureauOk)  return { entered: null, bureau,          match: null, status: 'not_provided' };

  // Both have values — fuzzy token-based comparison
  const e = normalizeStr(entered);
  const b = normalizeStr(bureau);
  const prefix = Math.min(fuzzyLength, Math.min(e.length, b.length));
  const matched =
    e === b ||
    (prefix >= 4 && (e.includes(b.substring(0, prefix)) || b.includes(e.substring(0, prefix))));

  return { entered, bureau, match: matched, status: matched ? 'matched' : 'mismatch' };
};

// Phone-specific comparison: strip all non-digits before comparing
const comparePhone = (entered, bureau) => {
  if (!hasValue(entered) && !hasValue(bureau)) return { entered: null, bureau: null, match: null, status: 'both_empty' };
  if (hasValue(entered) && !hasValue(bureau))  return { entered, bureau: null, match: null, status: 'unavailable' };
  if (!hasValue(entered) && hasValue(bureau))  return { entered: null, bureau, match: null, status: 'not_provided' };

  const e = (entered ?? '').replace(/\D/g, '');
  const b = (bureau  ?? '').replace(/\D/g, '');
  const matched = e === b || e.endsWith(b.slice(-9)) || b.endsWith(e.slice(-9));
  return { entered, bureau, match: matched, status: matched ? 'matched' : 'mismatch' };
};

/**
 * Compares borrower-entered data against bureau-verified data.
 * Only true conflicts (both sides populated, values differ) produce mismatch flags.
 *
 * @param {Object} borrowerData  — { phoneNumber, emailAddress, residentialAddress, employerName }
 * @param {Object} bureauResult  — normalized response from normalizeResponse()
 * @returns {{ mismatchFlags: string[], comparedFields: Object }}
 */
const detectMismatches = (borrowerData = {}, bureauResult = {}) => {
  const phoneResult    = comparePhone(borrowerData.phoneNumber,        bureauResult.verifiedPhone);
  const emailResult    = compareField(borrowerData.emailAddress,       bureauResult.verifiedEmail);
  const addressResult  = compareField(borrowerData.residentialAddress, bureauResult.verifiedResidentialAddress, 10);
  const employerResult = compareField(borrowerData.employerName,       bureauResult.verifiedEmployer, 6);

  // Only push to mismatchFlags when status === 'mismatch' (both values present and differ)
  const mismatchFlags = [];
  if (phoneResult.status    === 'mismatch') mismatchFlags.push('phoneMismatch');
  if (emailResult.status    === 'mismatch') mismatchFlags.push('emailMismatch');
  if (addressResult.status  === 'mismatch') mismatchFlags.push('addressMismatch');
  if (employerResult.status === 'mismatch') mismatchFlags.push('employerMismatch');

  const comparedFields = {
    phone:    phoneResult,
    email:    emailResult,
    address:  addressResult,
    employer: employerResult,
  };

  return { mismatchFlags, comparedFields };
};

// ─── Main caller ──────────────────────────────────────────────────────────────

/**
 * Calls the Datanamix Address Plus Profile IDV API.
 *
 * @param {Object} params
 * @param {string}  params.surname
 * @param {string}  params.idNumber
 * @param {string}  [params.passportNumber]
 * @param {string}  [params.clientReference]
 * @param {Object}  [params.borrowerData]   — { phoneNumber, emailAddress, residentialAddress, employerName }
 * @returns {Promise<Object>} Normalized bureau result + mismatch analysis
 */
const callAddressPlusProfileIdv = async ({
  surname,
  idNumber,
  passportNumber = '',
  clientReference,
  borrowerData = {},
}) => {
  if (!idNumber) throw new Error('IDNumber is required for bureau verification');
  if (!surname)  throw new Error('Surname is required for bureau verification');

  const reference = clientReference || `BUREAU-${Date.now()}`;

  const payload = {
    Surname:               surname,
    IDNumber:              idNumber,
    PassportNumber:        passportNumber,
    ClientReference:       reference,
    OutputFormat:          'JSON_AND_PDF',
    PDFEncryptionPassword: '0123456789',
    EnvironmentType:       'SANDBOX',
  };

  console.log("ADDRESS PLUS OUTGOING PAYLOAD", payload);

  const response = await datanamixAxiosClient.post(ENDPOINT, payload);

  console.log("RAW ADDRESS PLUS RESPONSE", response.data);

  const normalized = normalizeResponse(response.data);
  const { mismatchFlags, comparedFields } = detectMismatches(borrowerData, normalized);

  console.log(
    `[BUREAU] Status: ${normalized.verificationStatus} | Deceased: ${normalized.deceasedStatus} | SAFPS: ${normalized.safpsFlag} | Mismatches: ${mismatchFlags.join(', ') || 'none'}`
  );

  return { ...normalized, mismatchFlags, comparedFields };
};

module.exports = { callAddressPlusProfileIdv, detectMismatches };

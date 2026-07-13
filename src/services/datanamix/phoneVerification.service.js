const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/phone/contact-to-id-search';

const validateSAPhone = (phone) => {
  if (!phone) return false;
  return /^0\d{9}$/.test(phone.trim());
};

const validateFullName = (name) => {
  if (!name) return false;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const words = trimmed.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  return /^[a-zA-Z\s]+$/.test(trimmed);
};

const formatFullName = (name) => {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

// ─── Name matching helpers ────────────────────────────────────────────────────

const normalizeToken = (s) => (s ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');

/**
 * Returns a 0–1 score for how well the borrower's entered full name
 * matches the API-returned firstName + surname.
 * Allows for partial matches, initials, and ordering differences.
 */
const nameMatchScore = (borrowerFullName, apiFirstName, apiSurname) => {
  const borrowerTokens = (borrowerFullName ?? '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  if (!borrowerTokens.length) return 0;

  const first   = normalizeToken(apiFirstName);
  const surname = normalizeToken(apiSurname);

  const hits = borrowerTokens.filter(
    (t) =>
      (first   && (first.startsWith(t)   || t.startsWith(first)))   ||
      (surname && (surname.startsWith(t) || t.startsWith(surname)))
  ).length;

  return hits / borrowerTokens.length;
};

// ─── Response normalizer ──────────────────────────────────────────────────────

const normalizeResponse = (raw) => {
  console.log(
    '[PHONE-VERIFY] Raw Datanamix Contact To ID response:\n',
    JSON.stringify(raw, null, 2)
  );

  const header  = raw.Header  ?? {};
  const result  = raw.Result  ?? {};
  const success = raw.Success === true || raw.Success === 'true' || raw.Success === 'True';

  const rawConsumers = Array.isArray(result.ListOfConsumers) ? result.ListOfConsumers : [];

  const matchedConsumers = rawConsumers.map((c) => ({
    idNumber:   c.IdNumber   ?? c.IDNumber   ?? null,
    firstName:  c.FirstName  ?? null,
    secondName: c.SecondName ?? null,
    surname:    c.Surname    ?? null,
    fullName:   [c.FirstName, c.SecondName, c.Surname].filter(Boolean).join(' '),
  }));

  return {
    success,
    reportReference: raw.ReportReference ?? header.ReportReference ?? null,
    searchDate:      header.SearchDate   ?? null,
    responseCode:    raw.ResponseCode    ?? null,
    messages:        Array.isArray(raw.Messages) ? raw.Messages : [],
    matchedConsumers,
    rawResponse: raw,
  };
};

// ─── Ownership match engine ───────────────────────────────────────────────────

/**
 * Compares borrower-supplied identity against the list of consumers returned
 * by the phone ownership lookup.
 *
 * Rules:
 *   • No consumers returned           → Rejected
 *   • No ID number match              → Rejected
 *   • ID matches but name < 40% score → Rejected
 *   • ID matches and name ≥ 40%       → Verified
 *     (name 40–70% sets mismatchDetected flag as a soft warning)
 */
const runOwnershipMatch = (normalized, borrowerIdNumber, borrowerFullName) => {
  const { matchedConsumers } = normalized;

  if (!matchedConsumers.length) {
    return {
      ownershipMatched:   false,
      mismatchDetected:   true,
      verificationStatus: 'Rejected',
      mismatchReason:     'No consumers returned by the phone verification API.',
    };
  }

  const idMatch = matchedConsumers.find(
    (c) => c.idNumber && c.idNumber.trim() === (borrowerIdNumber ?? '').trim()
  );

  if (!idMatch) {
    return {
      ownershipMatched:   false,
      mismatchDetected:   true,
      verificationStatus: 'Rejected',
      mismatchReason:     'Borrower ID number not found in phone ownership records.',
    };
  }

  const score = nameMatchScore(borrowerFullName, idMatch.firstName, idMatch.surname);

  if (score < 0.4) {
    return {
      ownershipMatched:   false,
      mismatchDetected:   true,
      verificationStatus: 'Rejected',
      mismatchReason:     `Name mismatch: entered "${borrowerFullName}" vs returned "${idMatch.fullName}".`,
    };
  }

  return {
    ownershipMatched:   true,
    mismatchDetected:   score < 0.7,   // partial match: ownership confirmed, soft flag raised
    verificationStatus: 'Verified',
    mismatchReason:     null,
  };
};

// ─── Main caller ──────────────────────────────────────────────────────────────

/**
 * Calls the Datanamix Contact To ID Search API and returns a normalized,
 * ownership-matched result.
 *
 * @param {Object} params
 * @param {string}  params.phoneNumber      - SA phone number to look up
 * @param {string}  params.idNumber         - Borrower SA ID (for ownership matching)
 * @param {string}  params.fullName         - Borrower full name (for name match)
 * @param {string}  [params.clientReference]
 * @returns {Promise<Object>} Normalized result with verificationStatus and match fields
 */
const callPhoneVerification = async ({ phoneNumber, idNumber, fullName, clientReference }) => {
  if (!phoneNumber) throw new Error('phoneNumber is required for phone verification');
  if (!idNumber)    throw new Error('idNumber is required for phone verification');

  if (!validateSAPhone(phoneNumber)) {
    throw new Error('Enter a valid South African phone number.');
  }

  if (!validateFullName(fullName)) {
    throw new Error('Enter borrower full legal name.');
  }

  const formattedName = formatFullName(fullName);
  const reference = clientReference || `PHONE-${Date.now()}`;

  const payload = {
    EnvironmentType:       process.env.DATANAMIX_ENVIRONMENT || 'SANDBOX',
    PhoneNumber:           phoneNumber,
    OutputFormat:          'JSON',
    PDFEncryptionPassword: '0123456789',
    ClientReference:       reference,
  };

  console.log("PHONE VERIFICATION OUTGOING PAYLOAD", payload);

  const response    = await datanamixAxiosClient.post(ENDPOINT, payload);

  console.log("RAW PHONE VERIFICATION RESPONSE", response.data);

  const normalized  = normalizeResponse(response.data);
  const matchResult = runOwnershipMatch(normalized, idNumber, formattedName);

  console.log(
    `[PHONE-VERIFY] Status: ${matchResult.verificationStatus} | Ownership: ${matchResult.ownershipMatched}`
  );

  return {
    ...normalized,
    ...matchResult,
    verifiedPhoneNumber: phoneNumber,
  };
};

module.exports = { callPhoneVerification };

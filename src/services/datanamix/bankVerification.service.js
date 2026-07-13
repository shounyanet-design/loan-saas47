const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/bank/account-verification-advanced';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Capitalise a single word: "JOHN" → "John"
const capitalize = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '');

// Initials from given names only (all words EXCEPT the surname / last word)
// "JOHN DOE SOAP" → firstName="John", surname="Soap", initials="JD"
const deriveGivenNameInitials = (nameParts) => {
  if (!nameParts || nameParts.length === 0) return '';
  if (nameParts.length === 1) return nameParts[0][0]?.toUpperCase() ?? '';
  return nameParts.slice(0, -1).map(p => p[0]?.toUpperCase() ?? '').filter(Boolean).join('');
};

// Datanamix returns Yes/No or Y/N; normalise to "Yes" / "No" / null
const parseYesNo = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim().toLowerCase();
  if (s.startsWith('y')) return 'Yes';
  if (s.startsWith('n')) return 'No';
  return String(val);
};

// ─── Response normalizer ──────────────────────────────────────────────────────

const normalizeResponse = (raw) => {
  console.log('[BANK-VERIFY] Raw AVS Advanced response:\n', JSON.stringify(raw, null, 2));

  const header  = raw?.Header  ?? {};
  const avs     = raw?.Avs     ?? raw?.AVS ?? raw?.avs ?? {};
  const success = raw?.Success === true || raw?.Success === 'true' || raw?.Success === 'True';

  return {
    success,
    reportReference: raw?.ReportReference ?? header.ReportReference ?? null,
    searchDate:      header.SearchDate   ?? null,
    responseCode:    raw?.ResponseCode    ?? null,
    avs: {
      status:               avs.Status            ?? avs.status            ?? null,
      statusMessage:        avs.StatusMessage     ?? avs.statusMessage     ?? null,
      accountFound:         parseYesNo(avs.accountFound     ?? avs.AccountFound),
      accountOpen:          parseYesNo(avs.accountOpen      ?? avs.AccountOpen),
      acceptsCredits:       parseYesNo(avs.acceptsCredits   ?? avs.AcceptsCredits),
      identityMatch:        parseYesNo(avs.identityMatch    ?? avs.IdentityMatch),
      accountTypeMatch:     parseYesNo(avs.accountTypeMatch ?? avs.AccountTypeMatch),
      initialsMatch:        parseYesNo(avs.initialsMatch    ?? avs.InitialsMatch),
      nameMatch:            parseYesNo(avs.nameMatch        ?? avs.NameMatch),
      emailMatch:           parseYesNo(avs.emailMatch       ?? avs.EmailMatch),
      phoneMatch:           parseYesNo(avs.phoneMatch       ?? avs.PhoneMatch),
      bankReference:        avs.bankReference        ?? avs.BankReference        ?? null,
      bankStatusCode:       avs.bankStatusCode       ?? avs.BankStatusCode       ?? null,
      bankStatusMessage:    avs.bankStatusMessage    ?? avs.BankStatusMessage    ?? null,
      bankResponseTimestamp:avs.bankResponseTimestamp ?? avs.BankResponseTimestamp ?? null,
    },
    pdfReport:   raw?.PDFReport ?? null,
    rawResponse: raw,
  };
};

// ─── Verification decision engine ─────────────────────────────────────────────

const runVerificationDecision = (normalized) => {
  const { avs, success } = normalized;

  // Actual Datanamix status strings inside response.Avs:
  // Verified, VerifiedWithErrors, Failed, NotFound
  const rawStatus = String(avs.status ?? '').trim();
  const isRawSuccess = ['Verified', 'VerifiedWithErrors'].includes(rawStatus) || success === true;

  // Mismatch warnings (initials, phone, email mismatch)
  const hasMismatchWarning =
    avs.initialsMatch === 'No' ||
    avs.phoneMatch === 'No' ||
    avs.emailMatch === 'No';

  // Fatal failures
  const isFatalFailure =
    avs.accountFound === 'No' ||
    avs.accountOpen === 'No' ||
    avs.identityMatch === 'No' ||
    rawStatus === 'Failed' ||
    rawStatus === 'NotFound';

  let verificationStatus = 'FAILED';

  if (isFatalFailure) {
    verificationStatus = 'FAILED';
  } else if (isRawSuccess) {
    if (hasMismatchWarning || rawStatus === 'VerifiedWithErrors') {
      verificationStatus = 'VERIFIED_WITH_WARNINGS';
    } else {
      verificationStatus = 'VERIFIED';
    }
  } else {
    verificationStatus = 'FAILED';
  }

  // Setup readable status messages
  let statusMessage = avs.statusMessage ?? '';
  if (verificationStatus === 'VERIFIED') {
    statusMessage = statusMessage || 'Bank account ownership verified successfully';
  } else if (verificationStatus === 'VERIFIED_WITH_WARNINGS') {
    const reasons = [];
    if (avs.initialsMatch === 'No') reasons.push('Initials mismatch');
    if (avs.phoneMatch === 'No') reasons.push('Phone mismatch');
    if (avs.emailMatch === 'No') reasons.push('Email mismatch');
    if (rawStatus === 'VerifiedWithErrors') reasons.push('Verified with minor errors');
    statusMessage = reasons.length > 0 
      ? `VERIFIED WITH WARNINGS: ${reasons.join(', ')}`
      : 'Bank Account Verified with Exceptions';
  } else {
    const reasons = [];
    if (avs.accountFound === 'No') reasons.push('Account closed or not found');
    if (avs.accountOpen === 'No') reasons.push('Account closed');
    if (avs.identityMatch === 'No') reasons.push('Identity mismatch');
    statusMessage = reasons.length > 0
      ? `VERIFICATION FAILED: ${reasons.join(', ')}`
      : statusMessage || 'Bank verification was unsuccessful.';
  }

  return {
    verificationStatus,
    statusMessage,
    avsStatus: verificationStatus,
    verificationTimestamp: new Date()
  };
};

// ─── Main caller ──────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string}  params.fullName         - Borrower full name from DB (FirstName + [Middle] + Surname)
 * @param {string}  params.bankName        - Bank name (informational)
 * @param {string}  params.accountNumber   - Bank account number
 * @param {string}  params.branchCode      - Branch/sort code
 * @param {string}  params.accountType     - "Current" | "Savings" | "Transmission"
 * @param {string}  params.phoneNumber     - Mobile number
 * @param {string}  params.emailAddress    - Email address
 * @param {string}  params.idNumber        - SA ID number
 * @param {string}  [params.clientReference]
 */
const callBankVerification = async ({
  fullName,
  bankName,
  accountNumber,
  branchCode,
  accountType,
  phoneNumber,
  emailAddress,
  idNumber,
  clientReference,
}) => {
  // Input Trim Sanitization - trim all inputs to prevent trailing space verification failures
  const cleanFullName      = String(fullName ?? '').trim();
  const cleanBankName      = String(bankName ?? '').trim();
  const cleanAccountNumber = String(accountNumber ?? '').trim();
  const cleanBranchCode    = String(branchCode ?? '').trim();
  const cleanAccountType   = String(accountType ?? '').trim();
  const cleanPhoneNumber   = String(phoneNumber ?? '').trim();
  const cleanEmailAddress  = String(emailAddress ?? '').trim();
  const cleanIdNumber      = String(idNumber ?? '').trim();
  const cleanReference     = String(clientReference ?? '').trim();

  if (!cleanAccountNumber) throw new Error('accountNumber is required for bank verification');
  if (!cleanIdNumber)      throw new Error('idNumber is required for bank verification');

  const reference    = cleanReference || `BANK-${Date.now()}`;
  const resolvedType = cleanAccountType || 'Current';
  const isSandbox    = process.env.NODE_ENV !== 'production';

  // ── Sandbox identity override ──────────────────────────────────────────────
  // When the official Datanamix sandbox test ID is used, substitute the exact
  // identity combination from the Datanamix AVS documentation instead of
  // attempting to parse the DB borrower name (which would not match sandbox records).
  const SANDBOX_TEST_ID = '0000000000001';
  const useSandboxOverride = isSandbox && cleanIdNumber === SANDBOX_TEST_ID;

  let firstName, surname, initials;

  if (useSandboxOverride) {
    console.log('[SANDBOX AVS OVERRIDE ACTIVE] Using official Datanamix sandbox identity — skipping DB name parsing.');
    firstName = 'John';
    surname   = 'Doe';
    initials  = 'JD';
  } else {
    const rawParts = cleanFullName.split(/\s+/).filter(Boolean);
    firstName      = capitalize(rawParts[0] ?? '');
    surname        = rawParts.length > 1 ? capitalize(rawParts[rawParts.length - 1]) : firstName;
    initials       = deriveGivenNameInitials(rawParts);
  }

  // Trim initials, first name, and surname explicitly as well
  const cleanInitials  = initials.trim();
  const cleanFirstName = firstName.trim();
  const cleanSurname   = surname.trim();

  const payload = {
    EnvironmentType:       isSandbox ? (process.env.DATANAMIX_ENVIRONMENT || 'SANDBOX') : 'LIVE',
    OutputFormat:          'JSON_AND_PDF',
    PDFEncryptionPassword: cleanIdNumber,
    ClientReference:       reference,
    Initials:              cleanInitials,
    FirstName:             cleanFirstName,
    Surname:               cleanSurname,
    IdentityType:          'IDNumber',
    IdentityNumber:        cleanIdNumber,
    BankAccountNumber:     cleanAccountNumber,
    BankBranchCode:        cleanBranchCode,
    BankAccountType:       resolvedType,
    MobileNumber:          cleanPhoneNumber,
    EmailAddress:          cleanEmailAddress,
  };

  console.log('[BANK-VERIFY] FINAL SANITIZED AVS PAYLOAD', JSON.stringify(payload, null, 2));
  console.log(`[BANK-VERIFY] Calling AVS Advanced — Account: ${cleanAccountNumber} | Ref: ${reference}`);

  const response   = await datanamixAxiosClient.post(ENDPOINT, payload);
  const normalized = normalizeResponse(response.data);
  const decision   = runVerificationDecision(normalized);

  console.log(`[BANK-VERIFY] Status: ${decision.verificationStatus}`);

  return {
    ...normalized,
    ...decision,
    verifiedBankAccount: cleanAccountNumber,
    verifiedBranchCode:  cleanBranchCode,
    verifiedAccountType: resolvedType,
  };
};

module.exports = { callBankVerification };

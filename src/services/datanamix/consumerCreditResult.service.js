const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/credit/datanamix/consumer-result';

// ─── Safe accessor helpers ────────────────────────────────────────────────────

/** Returns an empty array for any non-array value. */
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Safe number conversion.
 * Returns null for empty string, undefined, null, or NaN.
 * Handles numeric strings like "1234.56" and "0" correctly.
 */
const safeNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/** Alias used for optional numeric fields (returns null when missing). */
const num = safeNum;

/** Returns null for null/undefined; otherwise coerces to string. */
const str = (v) => (v !== null && v !== undefined ? String(v) : null);

/** Truthy check covering boolean true, "Y"/"y", and /^yes/i strings. */
const bool = (v) =>
  v === true ||
  v === 'Y' || v === 'y' ||
  (typeof v === 'string' && /^yes/i.test(v.trim()));

/** Count fields always produce 0 instead of null. */
const cnt = (v) => Number(v) || 0;

/**
 * Safe date coercion.
 * Returns null for empty strings, "0", years before 1900 (Datanamix placeholder
 * 0001-01-01T00:00:00), and unparseable values.
 */
const safeDate = (v) => {
  if (!v || v === '0' || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime()) || d.getFullYear() < 1900) return null;
  return String(v);
};

// ─── Month key sequence (M24 → M01) ──────────────────────────────────────────
// Datanamix encodes 24-month payment history as individual object keys M01…M24.
const MONTH_KEYS = Array.from({ length: 24 }, (_, i) => {
  const n = 24 - i;
  return `M${String(n).padStart(2, '0')}`;
}); // ['M24', 'M23', ..., 'M01']

/**
 * Extracts the 24-month payment cells from a single payment history entry.
 * Falls back to a PaymentMonths array if the M01…M24 keys are absent (legacy).
 *
 * @param   {Object} m           - Raw monthly payment entry
 * @param   {Object} headerLabels - Map of M24→date-label from payment header
 * @returns {Array<{month,label,code,status,period}>}
 */
const extractMonthCells = (m, headerLabels = {}) => {
  // Prefer individual M24..M01 keys; fall back to PaymentMonths array
  const hasMKeys = MONTH_KEYS.some((k) => m[k] !== undefined && m[k] !== null);

  if (hasMKeys) {
    return MONTH_KEYS
      .filter((k) => m[k] !== undefined && m[k] !== null)
      .map((k) => {
        const code = str(m[k]);
        return {
          month:  k,
          label:  headerLabels[k] ?? k,
          period: headerLabels[k] ?? k,   // frontend uses pm.period for tooltip
          code,                            // frontend uses pm.code for styling
          status: code,                    // frontend uses pm.status for Current check
        };
      });
  }

  // Legacy fallback: PaymentMonths array
  return arr(m.PaymentMonths).map((pm) => ({
    month:  str(pm.Period),
    label:  str(pm.Period),
    period: str(pm.Period),
    code:   str(pm.PaymentCode ?? pm.Status),
    status: str(pm.Status ?? pm.PaymentCode),
  }));
};

// ─── Response normalizer ──────────────────────────────────────────────────────

const normalizeResponse = (raw) => {
  console.log(
    '[CREDIT-RESULT] Raw Datanamix Consumer Credit Result response:\n',
    JSON.stringify(raw, null, 2)
  );

  // ── Top-level envelope ────────────────────────────────────────────────────
  // Datanamix wraps all consumer data under raw.Consumer
  const consumer = raw.Consumer ?? {};

  // Header may sit at root or inside Consumer
  const header  = raw.Header ?? consumer.Header ?? {};
  const success = raw.Success === true || raw.Success === 'true' || raw.Success === 'True';

  // ── Credit score ──────────────────────────────────────────────────────────
  const sc = consumer.ConsumerScoring ?? {};
  const scoring = {
    finalScore:       num(sc.FinalScore ?? sc.Score),
    classification:   str(sc.Classification),
    riskCategory:     str(sc.RiskCategory),
    scoreDescription: str(sc.ScoreDescription ?? sc.Description),
    modelId:          str(sc.ModelId ?? sc.Model),
    reasonCodes: Array.isArray(sc.ReasonCodes)
      ? sc.ReasonCodes
      : typeof sc.ReasonCodes === 'string'
        ? sc.ReasonCodes.split(',').map((r) => r.trim()).filter(Boolean)
        : [],
  };

  // ── Debt summary — ConsumerCPANLRDebtSummary ──────────────────────────────
  // FIX #1: real field is TotalOutStandingDebt (capital S), not TotalOutstandingDebt
  const ds = consumer.ConsumerCPANLRDebtSummary ?? {};
  const debtSummary = {
    totalOutstandingDebt:    num(ds.TotalOutStandingDebt ?? ds.TotalOutstandingBalance ?? ds.TotalOutstandingDebt),
    totalMonthlyInstallment: num(ds.TotalMonthlyInstalment ?? ds.TotalMonthlyInstallment),
    totalArrearsAmount:      num(ds.TotalArrearsAmount),
    totalAdverseAmount:      num(ds.TotalAdverseAmount),
    judgementCount:          cnt(ds.JudgementCount),
    courtNoticeCount:        cnt(ds.CourtNoticeCount),
    defaultListingCount:     cnt(ds.DefaultListingCount),
    highestMonthsInArrears:  cnt(ds.HighestMonthsInArrears),
  };

  // ── Fraud indicators ──────────────────────────────────────────────────────
  const fi = consumer.ConsumerFraudIndicatorsSummary ?? {};
  const fraudIndicators = {
    safpsListed:         bool(fi.SAFPSListingYN),
    deceasedStatus:      bool(fi.HomeAffairsDeceasedStatus),
    debtReviewStatus:    bool(fi.DebtReviewStatus),
    homeAffairsVerified: bool(fi.HomeAffairsVerificationYN),
  };

  // ── Consumer personal details ─────────────────────────────────────────────
  // FIX #2: real field is ConsumerDetail (singular), not ConsumerDetails
  const cd = consumer.ConsumerDetail ?? consumer.ConsumerDetails ?? {};
  const consumerDetails = {
    firstName:           str(cd.FirstName),
    surname:             str(cd.Surname),
    idNumber:            str(cd.IDNumber),
    birthDate:           safeDate(cd.BirthDate),
    gender:              str(cd.Gender),
    email:               str(cd.EmailAddress ?? cd.Email),
    cellularNo:          str(cd.CellularNo ?? cd.CellNumber ?? cd.PhoneNumber),
    residentialAddress:  str(cd.ResidentialAddress),
    postalAddress:       str(cd.PostalAddress),
  };

  // ── Account summary — merge CPANLR + NLR ─────────────────────────────────
  // FIX #6: real field names use Amt suffix and different naming conventions
  const cpanlrAccounts = arr(consumer.ConsumerAccountStatus);
  const nlrAccounts    = arr(consumer.ConsumerNLRAccountStatus);
  const accountSummary = [...cpanlrAccounts, ...nlrAccounts].map((a) => ({
    subscriberName:  str(a.SubscriberName),
    accountType:     str(a.AccountType ?? a.AccountTypeDesc),
    creditLimit:     num(a.CreditLimitAmt    ?? a.CreditLimit),
    balance:         num(a.CurrentBalanceAmt ?? a.CurrentBalance),
    instalment:      num(a.MonthlyInstalmentAmt ?? a.MonthlyInstalment),
    arrears:         num(a.ArrearsAmt          ?? a.ArrearsAmount),
    status:          str(a.StatusCodeDesc      ?? a.AccountStatus),
    openDate:        safeDate(a.AccountOpenedDate ?? a.AccountOpenDate),
    lastPaymentDate: safeDate(a.LastPaymentDate),
    accountNumber:   str(a.AccountNumber),
  }));

  // ── Adverse information ───────────────────────────────────────────────────
  // FIX #10: real array keys inside AdverseInformation container
  const ai = consumer.AdverseInformation ?? {};
  const adverseInformation = {
    judgments: arr(ai.ConsumerJudgement ?? ai.Judgements).map((j) => ({
      caseNumber: str(j.CaseNumber),
      date:       safeDate(j.JudgementDate ?? j.Date),
      amount:     num(j.JudgementAmount ?? j.Amount),
      creditor:   str(j.PlaintiffName ?? j.CreditorName ?? j.CompanyName),
      status:     str(j.Status ?? j.StatusDesc),
    })),
    defaults: arr(ai.ConsumerDefaults ?? ai.Defaults).map((d) => ({
      subscriberName: str(d.SubscriberName),
      date:           safeDate(d.DefaultDate ?? d.DateListed ?? d.Date),
      amount:         num(d.DefaultAmount ?? d.Amount),
      reason:         str(d.DefaultReason ?? d.Reason),
      status:         str(d.Status ?? d.StatusDesc),
    })),
    sequestration: arr(ai.ConsumerSequestration ?? ai.Sequestration).map((s) => ({
      date:   safeDate(s.Date ?? s.SequestrationDate),
      type:   str(s.Type ?? s.SequestrationTypeDesc),
      amount: num(s.Amount),
    })),
    adminOrders: arr(ai.ConsumerAdminOrder ?? ai.AdministrationOrders).map((o) => ({
      date:     safeDate(o.Date ?? o.OrderDate),
      amount:   num(o.Amount ?? o.OrderAmount),
      creditor: str(o.CreditorName ?? o.CompanyName),
    })),
    rehabilitation: arr(ai.ConsumerRehabilitationOrder ?? ai.RehabilitationOrders).map((r) => ({
      date: safeDate(r.Date ?? r.RehabilitationDate),
      type: str(r.Type ?? r.RehabilitationTypeDesc),
    })),
  };

  // ── Properties ────────────────────────────────────────────────────────────
  // FIX #4: real field names use Desc/Amt/Name suffixes
  const properties = arr(consumer.ConsumerPropertyInformation).map((p) => ({
    propertyType:   str(p.PropertyTypeDesc ?? p.PropertyType),
    city:           str(p.CityName ?? p.City),
    province:       str(p.ProvinceName ?? p.Province),
    purchaseDate:   safeDate(p.PurchaseDate),
    purchasePrice:  num(p.PurchasePriceAmt ?? p.PurchasePrice),
    bondAmount:     num(p.BondAmt ?? p.BondAmount),
    address:        str(p.PhysicalAddress ?? p.Address),
    bondHolder:     str(p.BondHolderName ?? p.BondHolder),
    registrationNo: str(p.RegistrationNo ?? p.RegistrationNumber),
  }));

  // ── Directorships ─────────────────────────────────────────────────────────
  // FIX #5: real field names differ from assumed schema
  const directorships = arr(consumer.ConsumerDirectorshipLink).map((d) => ({
    companyName:     str(d.CommercialName   ?? d.CompanyName),
    registrationNo:  str(d.RegistrationNo   ?? d.RegistrationNumber),
    appointmentDate: safeDate(d.AppointmentDate),
    resignationDate: safeDate(d.ResignationDate),
    status:          str(d.DirectorStatus   ?? d.Status),
    designation:     str(d.DirectorDesignationDesc ?? d.Designation),
  }));

  // ── Address history ───────────────────────────────────────────────────────
  // FIX #7: real fields are Address1/2/3 + PostalCode; combine into single string
  const addressHistory = arr(consumer.ConsumerAddressHistory).map((a) => {
    const parts = [a.Address1, a.Address2, a.Address3, a.PostalCode ?? a.Suburb]
      .filter(Boolean)
      .map(String);
    const combined = parts.length ? parts.join(', ') : (str(a.Address) ?? '');
    return {
      addressType:     str(a.AddressType ?? a.AddressTypeDesc),
      address:         combined || null,
      subscriberName:  str(a.SubscriberName),
      createdOnDate:   safeDate(a.CreatedOnDate  ?? a.FirstReportedDate),
      lastUpdatedDate: safeDate(a.LastUpdatedDate ?? a.DateLastUpdated),
    };
  });

  // ── Contact / email history ───────────────────────────────────────────────
  const contactHistory = arr(
    consumer.ConsumerContactDetail ?? consumer.ConsumerContactHistory ?? []
  ).map((c) => ({
    contactType:    str(c.ContactType ?? c.ContactTypeDesc),
    contactValue:   str(c.ContactValue ?? c.Number ?? c.Value),
    subscriberName: str(c.SubscriberName),
    lastUpdated:    safeDate(c.LastUpdatedDate),
  }));

  const emailHistory = arr(
    consumer.ConsumerEmailAddress ?? consumer.ConsumerEmailHistory ?? []
  ).map((e) => ({
    emailAddress:   str(e.EmailAddress),
    subscriberName: str(e.SubscriberName),
    lastUpdated:    safeDate(e.LastUpdatedDate),
  }));

  // ── Employment history ────────────────────────────────────────────────────
  // FIX #8: real fields are EmployerDetail and FirstReportedDate
  const employmentHistory = arr(
    consumer.ConsumerEmploymentHistory ?? consumer.ConsumerEmployerHistory ?? []
  ).map((e) => ({
    employerName:   str(e.EmployerDetail ?? e.EmployerName),
    designation:    str(e.Designation),
    startDate:      safeDate(e.FirstReportedDate ?? e.StartDate),
    endDate:        safeDate(e.EndDate),
    subscriberName: str(e.SubscriberName),
    lastUpdated:    safeDate(e.LastUpdatedDate),
  }));

  // ── Enquiry history ───────────────────────────────────────────────────────
  // FIX #9: real field is CreditGrantorEnquiryReasonDesc
  const enquiryHistory = arr(consumer.ConsumerEnquiryHistory).map((e) => ({
    enquiryDate:    safeDate(e.EnquiryDate),
    subscriberName: str(e.SubscriberName ?? e.CreditGrantorName),
    enquiryReason:  str(e.CreditGrantorEnquiryReasonDesc ?? e.EnquiryReason),
    amountEnquired: num(e.AmountEnquired ?? e.EnquiryAmount),
  }));

  // ── 24-month payment history — merge CPANLR + NLR ─────────────────────────
  // FIX #3: Datanamix uses individual M24..M01 keys, NOT a PaymentMonths array.
  //          Each object key M24..M01 contains the payment status code.
  //          Optional header objects provide human-readable date labels per key.
  const cpanlrHeader = consumer.Consumer24MonthlyPaymentHeader    ?? {};
  const nlrHeader    = consumer.ConsumerNLR24MonthlyPaymentHeader ?? {};

  const cpanlrPayments = arr(consumer.Consumer24MonthlyPayment);
  const nlrPayments    = arr(consumer.ConsumerNLR24MonthlyPayment);

  const monthlyPaymentHistory = [
    ...cpanlrPayments.map((m) => ({
      subscriberName: str(m.SubscriberName),
      accountType:    str(m.AccountType ?? m.AccountTypeDesc),
      months:         extractMonthCells(m, cpanlrHeader),
    })),
    ...nlrPayments.map((m) => ({
      subscriberName: str(m.SubscriberName),
      accountType:    str(m.AccountType ?? m.AccountTypeDesc),
      months:         extractMonthCells(m, nlrHeader),
    })),
  ];

  // ── Debug log ─────────────────────────────────────────────────────────────
  console.log('[CREDIT-RESULT NORMALIZED]', {
    finalScore:          scoring.finalScore,
    riskCategory:        scoring.riskCategory,
    judgementCount:      debtSummary.judgementCount,
    defaultListingCount: debtSummary.defaultListingCount,
    totalDebt:           debtSummary.totalOutstandingDebt,
  });

  return {
    success,
    reportReference:    str(header.ReportReference),
    reportDate:         safeDate(header.SearchDate ?? header.ReportDate),
    scoring,
    debtSummary,
    fraudIndicators,
    consumerDetails,
    accountSummary,
    adverseInformation,
    properties,
    directorships,
    addressHistory,
    contactHistory,
    emailHistory,
    employmentHistory,
    enquiryHistory,
    monthlyPaymentHistory,
    pdfReport:   raw.PDFReport ?? consumer.PDFReport ?? null,
    rawResponse: raw,
  };
};

// ─── Underwriting summary engine ─────────────────────────────────────────────
// DO NOT MODIFY — logic is correct and tested.

/**
 * Derives an automated loan underwriting recommendation from the credit report.
 *
 * Returns { level, riskCategory, reasons[] }
 * level: 'APPROVE' | 'REVIEW REQUIRED' | 'HIGH RISK' | 'VERY HIGH RISK' | 'DECLINE'
 */
const generateUnderwritingSummary = (n) => {
  const score         = n.scoring?.finalScore              ?? 0;
  const judgements    = n.debtSummary?.judgementCount      ?? 0;
  const defaults      = n.debtSummary?.defaultListingCount ?? 0;
  const arrears       = n.debtSummary?.totalArrearsAmount;
  const deceased      = n.fraudIndicators?.deceasedStatus  ?? false;
  const safps         = n.fraudIndicators?.safpsListed     ?? false;
  const debtReview    = n.fraudIndicators?.debtReviewStatus ?? false;
  const monthsArrears = n.debtSummary?.highestMonthsInArrears ?? 0;

  const reasons = [];

  // Fatal → DECLINE
  if (deceased) reasons.push('Deceased flag detected on Home Affairs record');
  if (safps)    reasons.push('SAFPS fraud listing detected');
  if (deceased || safps) {
    return { level: 'DECLINE', riskCategory: 'FATAL', reasons };
  }

  // Very high risk → DECLINE
  if ((score > 0 && score < 400) || judgements > 2 || defaults > 2) {
    if (score > 0 && score < 400) reasons.push(`Very low credit score (${score})`);
    if (judgements > 2)           reasons.push(`${judgements} judgement(s) on record`);
    if (defaults > 2)             reasons.push(`${defaults} default listing(s) on record`);
    return { level: 'DECLINE', riskCategory: 'VERY HIGH RISK', reasons };
  }

  // High risk
  if (score < 500 || judgements > 0 || defaults > 0 || debtReview) {
    if (score > 0 && score < 500) reasons.push(`Low credit score (${score})`);
    if (judgements > 0)           reasons.push(`${judgements} judgement(s) on record`);
    if (defaults > 0)             reasons.push(`${defaults} default listing(s) on record`);
    if (debtReview)               reasons.push('Borrower under debt review');
    if (monthsArrears > 3)        reasons.push(`Highest arrears: ${monthsArrears} months`);
    return { level: 'HIGH RISK', riskCategory: 'HIGH RISK', reasons };
  }

  // Review required
  if (score < 600 || arrears > 0) {
    if (score < 600)       reasons.push(`Below-average credit score (${score})`);
    if (arrears > 0)       reasons.push(`R${arrears.toLocaleString()} total arrears outstanding`);
    if (monthsArrears > 0) reasons.push(`Highest arrears: ${monthsArrears} months`);
    return { level: 'REVIEW REQUIRED', riskCategory: 'MEDIUM RISK', reasons };
  }

  reasons.push(`Credit score ${score} meets lending criteria`);
  return { level: 'APPROVE', riskCategory: 'LOW RISK', reasons };
};

// ─── Main caller ──────────────────────────────────────────────────────────────

/**
 * Fetches the full Datanamix Consumer Credit Report Result.
 * Requires enquiryId + enquiryResultId from the preceding Consumer Credit Search.
 *
 * @param {Object} params
 * @param {string}  params.enquiryId
 * @param {string}  params.enquiryResultId
 * @param {string}  [params.clientReference]
 * @returns {Promise<Object>} Normalized report + underwriting summary
 */
const callConsumerCreditResult = async ({ enquiryId, enquiryResultId, clientReference }) => {
  if (!enquiryId)       throw new Error('enquiryId is required for Consumer Credit Result');
  if (!enquiryResultId) throw new Error('enquiryResultId is required for Consumer Credit Result');

  const reference = clientReference || `RESULT-${Date.now()}`;

  const payload = {
    EnvironmentType:       'SANDBOX',
    EnquiryId:             enquiryId,
    EnquiryResultId:       enquiryResultId,
    OutputFormat:          'JSON',
    PDFEncryptionPassword: '',
    ClientReference:       reference,
  };

  console.log(
    `[CREDIT-RESULT] Calling Datanamix Consumer Result — EnquiryID: ${enquiryId} | Ref: ${reference}`
  );

  const response     = await datanamixAxiosClient.post(ENDPOINT, payload);
  const normalized   = normalizeResponse(response.data);
  const underwriting = generateUnderwritingSummary(normalized);

  console.log(
    `[CREDIT-RESULT] Score: ${normalized.scoring.finalScore} | Risk: ${underwriting.riskCategory} | Decision: ${underwriting.level}`
  );

  return { ...normalized, underwriting };
};

module.exports = { callConsumerCreditResult, generateUnderwritingSummary };

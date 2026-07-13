const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/credit/datanamix/consumer-result';

// ─── Safe accessor helpers ────────────────────────────────────────────────────
const arr = (v) => (Array.isArray(v) ? v : []);

const safeNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const num = safeNum;
const str = (v) => (v !== null && v !== undefined ? String(v) : null);

const bool = (v) =>
  v === true ||
  v === 'Y' || v === 'y' ||
  (typeof v === 'string' && /^yes/i.test(v.trim()));

const cnt = (v) => Number(v) || 0;

const safeDate = (v) => {
  if (!v || v === '0' || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime()) || d.getFullYear() < 1900) return null;
  return String(v);
};

const MONTH_KEYS = Array.from({ length: 24 }, (_, i) => {
  const n = 24 - i;
  return `M${String(n).padStart(2, '0')}`;
});

const extractMonthCells = (m, headerLabels = {}) => {
  const hasMKeys = MONTH_KEYS.some((k) => m[k] !== undefined && m[k] !== null);

  if (hasMKeys) {
    return MONTH_KEYS
      .filter((k) => m[k] !== undefined && m[k] !== null)
      .map((k) => {
        const code = str(m[k]);
        return {
          month:  k,
          label:  headerLabels[k] ?? k,
          period: headerLabels[k] ?? k,
          code,
          status: code,
        };
      });
  }

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
  const consumer = raw.Consumer ?? {};
  const header  = raw.Header ?? consumer.Header ?? {};
  const success = raw.Success === true || raw.Success === 'true' || raw.Success === 'True';

  // 1. ConsumerScoring
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

  // 2. ConsumerCPANLRDebtSummary
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

  // 3. ConsumerFraudIndicatorsSummary
  const fi = consumer.ConsumerFraudIndicatorsSummary ?? {};
  const fraudIndicators = {
    safpsListed:         bool(fi.SAFPSListingYN),
    deceasedStatus:      bool(fi.HomeAffairsDeceasedStatus),
    debtReviewStatus:    bool(fi.DebtReviewStatus),
    homeAffairsVerified: bool(fi.HomeAffairsVerificationYN),
  };

  // 4. ConsumerDetail
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

  // 5. Account summary (CPANLR + NLR)
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

  // 6. Adverse information (defaults, judgments, sequestration, rehabilitation, etc.)
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

  // 7. ConsumerPropertyInformation
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

  // 8. ConsumerDirectorshipLink
  const directorships = arr(consumer.ConsumerDirectorshipLink).map((d) => ({
    companyName:     str(d.CommercialName   ?? d.CompanyName),
    registrationNo:  str(d.RegistrationNo   ?? d.RegistrationNumber),
    appointmentDate: safeDate(d.AppointmentDate),
    resignationDate: safeDate(d.ResignationDate),
    status:          str(d.DirectorStatus   ?? d.Status),
    designation:     str(d.DirectorDesignationDesc ?? d.Designation),
  }));

  // 9. ConsumerAddressHistory
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

  // 10. ConsumerEnquiryHistory
  const enquiryHistory = arr(consumer.ConsumerEnquiryHistory).map((e) => ({
    enquiryDate:    safeDate(e.EnquiryDate),
    subscriberName: str(e.SubscriberName ?? e.CreditGrantorName),
    enquiryReason:  str(e.CreditGrantorEnquiryReasonDesc ?? e.EnquiryReason),
    amountEnquired: num(e.AmountEnquired ?? e.EnquiryAmount),
  }));

  // 24-month payment history
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

/**
 * Main Caller to retrieve full credit report result from Datanamix.
 */
const callConsumerCreditReport = async ({ enquiryId, enquiryResultId, clientReference, isSandbox = true }) => {
  if (!enquiryId)       throw new Error('EnquiryId is required');
  if (!enquiryResultId) throw new Error('EnquiryResultId is required');

  const payload = {
    EnvironmentType:       isSandbox ? 'SANDBOX' : 'LIVE',
    EnquiryId:             enquiryId,
    EnquiryResultId:       enquiryResultId,
    OutputFormat:          'JSON_AND_PDF',
    PDFEncryptionPassword: '0123456789',
    ClientReference:       clientReference || `RESULT-${Date.now()}`,
  };

  console.log("CREDIT REPORT OUTGOING PAYLOAD:", JSON.stringify(payload, null, 2));

  const response = await datanamixAxiosClient.post(ENDPOINT, payload);
  const rawResponse = response.data;

  console.log("RAW CREDIT REPORT RESPONSE:", JSON.stringify(rawResponse, null, 2));

  const normalized = normalizeResponse(rawResponse);
  return normalized;
};

module.exports = { callConsumerCreditReport };

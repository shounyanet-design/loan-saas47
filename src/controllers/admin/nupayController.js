const asyncHandler = require('express-async-handler');
const nupayService = require('../../services/nupayService');
const debi24Service = require('../../services/debi24Service');
const LoanApplication = require('../../models/LoanApplication');
const BankVerification = require('../../models/BankVerification');
const Tenant = require('../../models/Tenant');
const idempotency = require('../../services/idempotencyService');

function resolveDebi24ClientId(tenant) {
  if (!tenant) return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
  if (tenant.debi24ClientId && String(tenant.debi24ClientId).trim()) {
    return String(tenant.debi24ClientId).trim();
  }
  if (tenant.isDefault) {
    return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
  }
  const rawName = String(tenant.companyName || tenant.companyCode || '').trim();
  if (rawName) {
    return rawName.replace(/\s+/g, '-');
  }
  return (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
}
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

    const bankRecord = await BankVerification.findOne({ applicationId: loan._id });

    let mandatePayload = mandate;
    if (!mandatePayload || Object.keys(mandatePayload).length === 0) {
      const verifiedAcc = loan.bankVerification?.verifiedBankAccount || bankRecord?.accountNumber || '';
      const verifiedBranch = loan.bankVerification?.verifiedBranchCode || bankRecord?.branchCode || '051001';
      const verifiedAccType = loan.bankVerification?.verifiedAccountType || '01';
      const bankName = bankRecord?.bankName || '';

      const rawPhone = loan.phoneNumber || '';
      let debtorPhone = rawPhone.replace(/\s+/g, '');
      if (debtorPhone.startsWith('0')) {
        debtorPhone = '+27-' + debtorPhone.substring(1);
      } else if (debtorPhone.startsWith('+27') && !debtorPhone.startsWith('+27-')) {
        debtorPhone = '+27-' + debtorPhone.substring(3);
      } else if (!debtorPhone.startsWith('+')) {
        debtorPhone = '+27-' + debtorPhone;
      }

      let accType = '01';
      if (verifiedAccType.toLowerCase().startsWith('sav')) accType = '01';
      else if (verifiedAccType.toLowerCase().startsWith('trans')) accType = '02';
      else if (verifiedAccType.toLowerCase().startsWith('che') || verifiedAccType.toLowerCase().startsWith('curr')) accType = '03';

      const mapBankNameToId = (name = '', branch = '') => {
        const b = String(branch || '').trim();
        if (b === '470010') return '10'; // Capitec Bank
        if (b === '632005') return '16'; // ABSA Bank
        if (b === '051001') return '1';  // Standard Bank
        if (b === '250655' || b === '250805') return '3'; // FNB
        if (b === '198765') return '2';  // Nedbank
        if (b === '678910') return '61'; // TymeBank
        if (b === '679000') return '63'; // Discovery Bank
        if (b === '430000') return '7';  // African Bank
        if (b === '462005') return '44'; // Bidvest Bank
        if (b === '589000') return '55'; // Finbond
        if (b === '431010') return '19'; // Ubank
        if (b === '410506') return '6';  // GroBank / Sasfin
        if (b === '450105') return '9';  // Mercantile
        if (b === '352000') return '67'; // Old Mutual

        const lower = name.toLowerCase();
        if (lower.includes('standard') || lower.includes('sbsa')) return '1';
        if (lower.includes('nedbank') || lower.includes('ned')) return '2';
        if (lower.includes('fnb') || lower.includes('first national')) return '3';
        if (lower.includes('grobank') || lower.includes('athens')) return '6';
        if (lower.includes('african')) return '7';
        if (lower.includes('mercantile')) return '9';
        if (lower.includes('capitec')) return '10';
        if (lower.includes('absa')) return '16';
        if (lower.includes('ubank')) return '19';
        if (lower.includes('bidvest')) return '44';
        if (lower.includes('finbond')) return '55';
        if (lower.includes('tyme')) return '61';
        if (lower.includes('discovery')) return '63';
        if (lower.includes('old mutual')) return '67';
        return '1';
      };

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDateStr = tomorrow.toISOString().split('T')[0];

      let collectionDay = '25';
      if (loan.repaymentDate) {
        const day = new Date(loan.repaymentDate).getDate();
        collectionDay = String(day).padStart(2, '0');
      } else if (loan.adminDecision?.approvedDate) {
        const day = new Date(loan.adminDecision.approvedDate).getDate();
        collectionDay = String(day).padStart(2, '0');
      }
      if (collectionDay === '31') {
        collectionDay = '30';
      }

      const instAmountVal = Number(loan.estimatedMonthlyEMI || loan.adminDecision?.approvedAmount || 10).toFixed(2);
      const maxAmountVal = (Number(instAmountVal) * 1.2).toFixed(2);

      mandatePayload = {
        frequency: 'MNTH',
        collectionDay,
        clientReference: loan.applicationId || 'LAPP-UNKNOWN',
        contractReference: (loan.applicationId || 'LAPPUNKNOWN').replace(/-/g, ''),
        debtorName: (loan.fullName || 'Client Name').substring(0, 30),
        debtorIdType: '2',
        debtorId: loan.idNumber || '9001015009087',
        debtorAccountNumber: verifiedAcc.replace(/\D/g, '') || '1234567890',
        debtorAccountType: accType,
        debtorBankId: mapBankNameToId(bankName, verifiedBranch),
        debtorBranchNumber: verifiedBranch.replace(/\D/g, '').padEnd(6, '0').substring(0, 6) || '051001',
        debtorIdUltimate: '',
        debtorPhoneNumber: debtorPhone,
        debtorEmail: loan.emailAddress || '',
        debtorAuthenticationRequired: '0230',
        firstCollectionAmount: '',
        firstCollectionDate: '',
        instalmentAmount: instAmountVal,
        maxCollectionAmount: maxAmountVal,
        adjustmentCategory: 'N',
        adjustmentAmount: '',
        adjustmentRate: '',
        startDate: startDateStr,
        dateAdjustmentRule: 'Y',
        debitValueTypeId: '1',
        instalments: loan.requestedDuration || 1,
        trackingIndicator: '00',
        mac: '',
        authenticationType: 'REAL TIME',
        entryClass: '0033',
        loadType: '1',
        nonWarehouseMandate: '0',
        smsOptIn: 'N',
        employerCode: '',
        insuranceModelID: '',
        insuranceAmount: ''
      };
    }

    const payload = validate(mandateInitiationSchema, mandatePayload);
    const tenant = await Tenant.findById(req.tenantId || loan.tenantId).lean();
    const debi24ClientId = resolveDebi24ClientId(tenant);
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
      () => {
        const { isDevelopmentSandboxBypassEnabled } = require('../../utils/devSandboxBypass');
        if (isDevelopmentSandboxBypassEnabled()) {
          return {
            outcome: 'ACCEPTED',
            providerStatus: 'ACCEPTED',
            resultCode: '900000',
            mandateId: 'MAND-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            clientReference: payload.clientReference,
            contractReference: payload.contractReference,
            providerTransactionId: 'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            providerMessageId: 'MSG-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            effectiveDate: payload.startDate,
            receivedAt: new Date().toISOString()
          };
        }
        if (process.env.DEBI24_API_KEY) {
          return debi24Service.createMandate(loan, bankRecord, key, debi24ClientId);
        }
        return nupayService.initiateMandate(payload, req.tenantId);
      }
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
      debi24ClientId: result.debi24ClientId || debi24ClientId,
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

const refreshDebiCheckMandate = asyncHandler(async (req, res) => {
  try {
    const { applicationId } = req.params;
    const loan = await LoanApplication.findOne({ _id: applicationId, tenantId: req.tenantId });
    if (!loan) return sendError(res, 'Loan application not found', 404);

    const mandateId = loan.nupayMandate?.mandateId || loan.debicheckMandateReference;
    if (!mandateId) return sendError(res, 'No mandate found for this loan', 400);

    const tenant = await Tenant.findById(req.tenantId || loan.tenantId).lean();
    const targetClientId = loan.nupayMandate?.debi24ClientId || resolveDebi24ClientId(tenant);

    if (process.env.DEBI24_API_KEY) {
      const refreshed = await debi24Service.refreshMandate(mandateId, targetClientId);
      const rawStatus = String(refreshed.status || refreshed.provider?.status || '').toUpperCase();
      let outcome = 'PENDING';
      if (rawStatus === 'ACCEPTED' || rawStatus === 'ACTIVE') outcome = 'ACCEPTED';
      else if (rawStatus === 'REJECTED' || rawStatus === 'FAILED') outcome = 'REJECTED';

      loan.debicheckMandateStatus = outcome;
      if (loan.nupayMandate) {
        loan.nupayMandate.outcome = outcome;
        loan.nupayMandate.status = outcome;
        loan.nupayMandate.providerStatus = outcome === 'ACCEPTED' ? 'ACCEPTED' : outcome === 'REJECTED' ? 'REJECTED' : 'PENDING AUTH';
        if (!loan.nupayMandate.debi24ClientId) {
          loan.nupayMandate.debi24ClientId = targetClientId;
        }
        loan.nupayMandate.updatedAt = new Date();
      }
      await loan.save();
      return sendSuccess(res, 'Mandate status refreshed', { outcome, status: refreshed.status, refreshed });
    }

    return sendError(res, 'Debi24 is not configured', 400);
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = {
  initiateDebiCheckMandate,
  refreshDebiCheckMandate,
  registerTT1Endpoint,
  getMandateReport,
  getInstalmentReport
};

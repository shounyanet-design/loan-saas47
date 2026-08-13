const asyncHandler = require('express-async-handler');
const nupayService = require('../../services/nupayService');
const LoanApplication = require('../../models/LoanApplication');
const idempotency = require('../../services/idempotencyService');
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

    let mandatePayload = mandate;
    if (!mandatePayload || Object.keys(mandatePayload).length === 0) {
      const BankVerification = require('../../models/BankVerification');
      const bankRecord = await BankVerification.findOne({ applicationId: loan._id });

      const verifiedAcc = loan.bankVerification?.verifiedBankAccount || bankRecord?.accountNumber || '';
      const verifiedBranch = loan.bankVerification?.verifiedBranchCode || bankRecord?.branchCode || '051001';
      const verifiedAccType = loan.bankVerification?.verifiedAccountType || '01';
      let bankName = bankRecord?.bankName || '';

      if (!bankName && verifiedBranch) {
        const branchStr = String(verifiedBranch).replace(/\D/g, '');
        if (branchStr === '470010') bankName = 'capitec';
        else if (branchStr === '250655') bankName = 'fnb';
        else if (branchStr === '198765') bankName = 'nedbank';
        else if (branchStr === '632005') bankName = 'absa';
        else if (branchStr === '051001' || branchStr === '51001') bankName = 'standard';
        else if (branchStr === '430000') bankName = 'african';
        else if (branchStr === '462005') bankName = 'bidvest';
        else if (branchStr === '678910') bankName = 'tyme';
        else if (branchStr === '679000') bankName = 'discovery';
        else if (branchStr === '589000') bankName = 'finbond';
        else if (branchStr === '431010') bankName = 'ubank';
        else if (branchStr === '450105') bankName = 'mercantile';
      }

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

      const mapBankNameToId = (name = '') => {
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
        debtorBankId: mapBankNameToId(bankName),
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

const {
  RealPayLocalPersistenceFailedError,
  RealPayProviderRejectionError,
  RealPayConfigurationError
} = require('../../errors/realpayErrors');

    const payload = validate(mandateInitiationSchema, mandatePayload);

    const currentStatus = String(loan.debicheckMandateStatus || loan.realPayMandate?.status || loan.nupayMandate?.outcome || '').toUpperCase();
    const isAccepted = currentStatus === 'ACCEPTED';
    const isPending = currentStatus === 'PENDING';
    const isTerminalFailure = ['REJECTED', 'FAILED', 'EXPIRED'].includes(currentStatus);
    const isExplicitReinitiate = Boolean(req.body?.reinitiate) || isTerminalFailure;

    if (isAccepted) {
      throw new RealPayConfigurationError('DebiCheck mandate is already ACCEPTED for this application.');
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay Reinitiate]', {
        applicationId: loan.applicationId,
        previousOutcome: currentStatus,
        previousProviderReferenceConfigured: Boolean(loan.realPayMandate?.providerReference || loan.nupayMandate?.mandateId),
        newAttempt: isExplicitReinitiate,
        clientRegisteredLocally: Boolean(loan.realPayClient?.registered)
      });
    }

    let attemptId = 'init';
    if (isExplicitReinitiate) {
      const lastUpdated = loan.realPayMandate?.updatedAt
        ? new Date(loan.realPayMandate.updatedAt).getTime()
        : (loan.updatedAt ? new Date(loan.updatedAt).getTime() : Date.now());
      attemptId = `attempt_${lastUpdated}`;
    }

    const key = req.headers['idempotency-key']
      || idempotency.buildKey('nupay', String(req.tenantId), 'initiateMandate', applicationId, payload.clientReference, attemptId);

    const { response: result, replayed } = await idempotency.runOnce(
      {
        key,
        scope: 'nupay',
        action: 'initiateMandate',
        tenantId: req.tenantId,
        request: { applicationId, mandate: payload }
      },
      async () => {
        const { isDevelopmentSandboxBypassEnabled } = require('../../utils/devSandboxBypass');
        if (isDevelopmentSandboxBypassEnabled()) {
          return {
            provider: 'REALPAY',
            outcome: 'ACCEPTED',
            providerStatus: 'ACCEPTED',
            resultCode: '900000',
            mandateId: 'RPM-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            clientReference: payload.clientReference,
            contractReference: payload.contractReference,
            providerTransactionId: 'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            providerMessageId: 'MSG-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            effectiveDate: payload.startDate,
            receivedAt: new Date().toISOString()
          };
        }

        const debitOrderProvider = require('../../services/payments/debitOrderProvider');
        const activeProvider = await debitOrderProvider.resolveProviderName(req.tenantId);

        if (activeProvider === 'realpay') {
          if (!loan.realPayClient?.registered) {
            const realpayService = require('../../services/realpay/realpayService');
            const clientResult = await realpayService.ensureRealPayClient(payload, req.tenantId);

            if (!clientResult || !clientResult.usable) {
              const code = clientResult?.statusCode || 'CLIENT_CREATION_FAILED';
              const desc = clientResult?.statusDescription || 'Failed to register client with RealPay';
              throw new RealPayProviderRejectionError(
                `RealPay client registration failed: [${code}] ${desc}`,
                422,
                clientResult
              );
            }

            loan.realPayClient = {
              clientNumber: clientResult.clientNumber || payload.clientReference,
              registered: Boolean(clientResult.registered),
              providerReference: clientResult.clientNumber || payload.clientReference,
              status: clientResult.status || 'REGISTERED',
              statusCode: clientResult.statusCode || '00',
              statusDescription: clientResult.statusDescription || 'Client registered successfully',
              registeredAt: new Date(),
              lastCheckedAt: new Date()
            };

            try {
              await loan.save();
            } catch (dbErr) {
              throw new RealPayLocalPersistenceFailedError(
                `Failed to persist RealPay client state locally: ${dbErr.message}`
              );
            }

            if (process.env.NODE_ENV !== 'test') {
              console.log('[RealPay Client Result]', {
                clientNumber: payload.clientReference,
                usable: true,
                persisted: true
              });
            }
          }
        }

        return debitOrderProvider.initiateMandate(payload, req.tenantId);
      }
    );

    loan.debicheckMandateStatus = result.outcome;
    loan.debicheckMandateReference = result.mandateId || result.providerReference || result.contractReference || '';

    if (result.provider === 'REALPAY') {
      loan.realPayMandate = {
        providerReference: result.mandateId || result.providerReference,
        mandateId: result.mandateId,
        contractSequence: result.contractSequence || loan.realPayMandate?.contractSequence || '',
        status: result.outcome,
        statusCode: result.statusCode || result.resultCode || '00',
        statusDescription: result.statusDescription || result.providerStatus || 'ACCEPTED',
        product: result.product || 'ABSADC',
        clientReference: result.clientReference,
        contractReference: result.contractReference,
        createdAt: loan.realPayMandate?.createdAt || new Date(),
        updatedAt: new Date()
      };
      if (result.realPayClient) {
        loan.realPayClient = {
          clientNumber: result.realPayClient.clientNumber || result.clientReference,
          registered: Boolean(result.realPayClient.registered),
          providerReference: result.realPayClient.clientNumber || result.clientReference,
          status: result.realPayClient.status || 'REGISTERED',
          statusCode: result.realPayClient.statusCode || '00',
          statusDescription: result.realPayClient.statusDescription || 'Client registered successfully',
          registeredAt: new Date(),
          lastCheckedAt: new Date()
        };
      }
    } else {
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
        updatedAt: new Date()
      };
    }
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

module.exports = {
  initiateDebiCheckMandate,
  registerTT1Endpoint,
  getMandateReport,
  getInstalmentReport
};

const asyncHandler = require('express-async-handler');
const LoanApplication = require('../../models/LoanApplication');
const BankVerification = require('../../models/BankVerification');
const realpayService = require('../../services/realpay/realpayService');
const debitOrderProvider = require('../../services/payments/debitOrderProvider');
const idempotency = require('../../services/idempotencyService');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const {
  RealPayLocalPersistenceFailedError,
  RealPayProviderRejectionError,
  RealPayConfigurationError
} = require('../../errors/realpayErrors');
const {
  simulateMandateEndpoint,
  simulateInstalmentEndpoint
} = require('./realpaySimulationController');

/**
 * Initiate RealPay DebiCheck Mandate for a Loan Application
 * POST /api/admin/realpay/mandates/initiate
 */
const initiateRealPayMandate = asyncHandler(async (req, res) => {
  const { applicationId, mandate } = req.body;
  if (!applicationId) return sendError(res, 'applicationId is required', 400);

  const loan = await LoanApplication.findOne({ _id: applicationId, tenantId: req.tenantId });
  if (!loan) return sendError(res, 'Loan application not found', 404);

  let mandatePayload = mandate;
  if (!mandatePayload || Object.keys(mandatePayload).length === 0) {
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
      bankName,
      debtorBankId: bankName,
      debtorBranchNumber: verifiedBranch.replace(/\D/g, '').padEnd(6, '0').substring(0, 6) || '051001',
      debtorPhoneNumber: debtorPhone,
      debtorEmail: loan.emailAddress || '',
      instalmentAmount: instAmountVal,
      maxCollectionAmount: maxAmountVal,
      startDate: startDateStr,
      instalments: loan.requestedDuration || 1,
      trackingIndicator: '00',
    };
  }

  const currentStatus = String(loan.debicheckMandateStatus || loan.realPayMandate?.status || '').toUpperCase();
  const isAccepted = currentStatus === 'ACCEPTED';
  const isTerminalFailure = ['REJECTED', 'FAILED', 'EXPIRED'].includes(currentStatus);
  const isExplicitReinitiate = Boolean(req.body?.reinitiate) || isTerminalFailure;

  if (isAccepted) {
    throw new RealPayConfigurationError('DebiCheck mandate is already ACCEPTED for this application.');
  }

  let attemptId = 'init';
  if (isExplicitReinitiate) {
    const lastUpdated = loan.realPayMandate?.updatedAt
      ? new Date(loan.realPayMandate.updatedAt).getTime()
      : (loan.updatedAt ? new Date(loan.updatedAt).getTime() : Date.now());
    attemptId = `attempt_${lastUpdated}`;
  }

  const key = req.headers['idempotency-key']
    || idempotency.buildKey('realpay', String(req.tenantId), 'initiateMandate', applicationId, mandatePayload.clientReference, attemptId);

  const { response: result, replayed } = await idempotency.runOnce(
    {
      key,
      scope: 'realpay',
      action: 'initiateMandate',
      tenantId: req.tenantId,
      request: { applicationId, mandate: mandatePayload }
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
          clientReference: mandatePayload.clientReference,
          contractReference: mandatePayload.contractReference,
          providerTransactionId: 'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
          providerMessageId: 'MSG-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
          effectiveDate: mandatePayload.startDate,
          receivedAt: new Date().toISOString()
        };
      }

      if (!loan.realPayClient?.registered) {
        const clientResult = await realpayService.ensureRealPayClient(mandatePayload, req.tenantId);

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
          clientNumber: clientResult.clientNumber || mandatePayload.clientReference,
          registered: Boolean(clientResult.registered),
          providerReference: clientResult.clientNumber || mandatePayload.clientReference,
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
      }

      return debitOrderProvider.initiateMandate(mandatePayload, req.tenantId);
    }
  );

  loan.debicheckMandateStatus = result.outcome;
  loan.debicheckMandateReference = result.mandateId || result.providerReference || result.contractReference || '';

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
});

module.exports = {
  initiateRealPayMandate,
  simulateMandateEndpoint,
  simulateInstalmentEndpoint
};

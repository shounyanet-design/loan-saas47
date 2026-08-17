const asyncHandler = require('express-async-handler');
const LoanApplication = require('../../models/LoanApplication');
const realpaySimulationService = require('../../services/realpay/realpaySimulation.service');
const { sendSuccess } = require('../../utils/responseHandler');
const { RealPayConfigurationError } = require('../../errors/realpayErrors');

/**
 * Admin endpoint: Simulate Mandate Result (UAT Only)
 * POST /api/admin/realpay/simulate/mandate
 * Body: { applicationId: "..." }
 */
const simulateMandateEndpoint = asyncHandler(async (req, res) => {
  const { applicationId, statusCode, result, force } = req.body || {};
  if (!applicationId) {
    throw new RealPayConfigurationError('applicationId is required');
  }

  const loan = await LoanApplication.findOne({
    $or: [{ _id: applicationId }, { applicationId }]
  });

  if (!loan) {
    return res.status(404).json({
      success: false,
      code: 'LOAN_NOT_FOUND',
      message: `Loan application with ID "${applicationId}" not found`
    });
  }

  const contractSeq = String(loan.realPayMandate?.contractSequence || '').trim();

  if (!contractSeq || contractSeq.startsWith('RPM-') || contractSeq.includes('LOCAL')) {
    throw new RealPayConfigurationError(
      'SIMULATION REQUIRES SUCCESSFUL MANDATE CREATION: ContractSequence is missing from realPayMandate'
    );
  }

  const isCompleted = loan.realPaySimulation?.mandate?.completedAt || loan.realPayMandate?.status === 'ACCEPTED';
  if (isCompleted && !force) {
    return res.status(400).json({
      success: false,
      code: 'REALPAY_SIMULATION_ALREADY_COMPLETED',
      message: `RealPay mandate simulation is already completed for contract ${contractSeq} (${loan.realPayMandate?.status || 'ACCEPTED'})`
    });
  }

  const simResult = await realpaySimulationService.simulateMandate(
    {
      contractSequence: contractSeq,
      statusCode: statusCode || 'S',
      result: result || 'AAUT'
    },
    req.tenantId
  );

  loan.realPaySimulation = loan.realPaySimulation || {};
  loan.realPaySimulation.environment = 'UAT';
  loan.realPaySimulation.mandate = {
    requestedAt: new Date(),
    contractSequence: contractSeq,
    statusCode: simResult.statusCode,
    result: simResult.outcome,
    providerStatus: simResult.providerStatus,
    providerMessage: simResult.statusDescription,
    completedAt: new Date()
  };

  await loan.save();

  return sendSuccess(res, 'RealPay mandate simulation request sent successfully', simResult);
});

/**
 * Admin endpoint: Simulate Instalment Result (UAT Only)
 * POST /api/admin/realpay/simulate/instalment
 * Body: { applicationId: "..." }
 */
const simulateInstalmentEndpoint = asyncHandler(async (req, res) => {
  const { applicationId, statusCode, result, force } = req.body || {};
  if (!applicationId) {
    throw new RealPayConfigurationError('applicationId is required');
  }

  const loan = await LoanApplication.findOne({
    $or: [{ _id: applicationId }, { applicationId }]
  });

  if (!loan) {
    return res.status(404).json({
      success: false,
      code: 'LOAN_NOT_FOUND',
      message: `Loan application with ID "${applicationId}" not found`
    });
  }

  const contractSeq = String(loan.realPayMandate?.contractSequence || '').trim();
  const instalmentSeq = String(loan.realPayMandate?.instalmentSequence || loan.realPaySimulation?.instalment?.instalmentSequence || '').trim();

  if (!contractSeq || contractSeq.startsWith('RPM-') || contractSeq.includes('LOCAL')) {
    throw new RealPayConfigurationError(
      'SIMULATION REQUIRES SUCCESSFUL MANDATE CREATION: ContractSequence is missing from realPayMandate'
    );
  }

  if (!instalmentSeq && !force) {
    throw new RealPayConfigurationError(
      'INSTALMENT_SIMULATION_BLOCKED_NO_SEQUENCE: Genuine InstalmentSequence is required from RealPay callback before simulation'
    );
  }

  const simResult = await realpaySimulationService.simulateInstalment(
    {
      contractSequence: contractSeq,
      instalmentSequence: instalmentSeq || '1',
      statusCode: statusCode || 'S',
      result: result || 'SUCC'
    },
    req.tenantId
  );

  loan.realPaySimulation = loan.realPaySimulation || {};
  loan.realPaySimulation.environment = 'UAT';
  loan.realPaySimulation.instalment = {
    requestedAt: new Date(),
    contractSequence: contractSeq,
    instalmentSequence: instalmentSeq || '1',
    statusCode: simResult.statusCode,
    result: simResult.outcome,
    providerStatus: simResult.providerStatus,
    providerMessage: simResult.statusDescription,
    completedAt: new Date()
  };

  await loan.save();

  return sendSuccess(res, 'RealPay instalment simulation request sent successfully', simResult);
});

module.exports = {
  simulateMandateEndpoint,
  simulateInstalmentEndpoint
};

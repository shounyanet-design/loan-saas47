const { disburseLoan } = require('../services/disbursement.service');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');

/**
 * POST /api/admin/loans/:applicationId/disburse
 * Triggers the actual disbursement for a READY_FOR_DISBURSEMENT loan.
 * Idempotent: re-calling when already disbursed returns the existing ActiveLoan.
 */
const disburse = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const userId = req.user?._id || req.user?.id;

    if (!tenantId) {
      return sendError(res, 'Tenant context is missing from request.', 400);
    }

    const { existing, activeLoan } = await disburseLoan(applicationId, { tenantId, userId });

    if (existing) {
      return sendSuccess(res, 'Loan was already disbursed. Returning existing ActiveLoan.', { activeLoan, alreadyDisbursed: true });
    }

    return sendSuccess(res, 'Loan disbursed successfully. ActiveLoan and repayment schedule created.', { activeLoan, alreadyDisbursed: false }, 201);
  } catch (err) {
    console.error('[DisbursementController] Error:', err.message);

    const statusMap = {
      'Loan application not found for tenant': 404,
      'Application not ready for disbursement': 422,
      'Pre-disbursement gates not satisfied': 422,
    };

    const status = statusMap[err.message] || 500;
    return sendError(res, err.message, status);
  }
};

module.exports = { disburse };

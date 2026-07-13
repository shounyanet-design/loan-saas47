const LoanApplication = require('../../../models/LoanApplication');
const { sendError } = require('../../../utils/responseHandler');

/**
 * Validates that the loan application exists and the user is authorized to interact with it.
 */
const validateAgreementAccess = async (req, res, next) => {
  const loanId = req.body?.loanApplicationId || req.body?.loanId || req.params.loanId;

  if (!loanId) {
    return sendError(res, 'Loan Application ID is required', 400);
  }

  try {
    const application = await LoanApplication.findById(loanId);
    if (!application) {
      return sendError(res, 'Loan application not found', 404);
    }

    // Role-based permissions
    const { role, _id } = req.user;

    if (role === 'borrower') {
      // Borrower can only access their own loan applications
      if (application.borrowerId.toString() !== _id.toString()) {
        return sendError(res, 'Unauthorized access to this loan application', 403);
      }
    } else if (role !== 'admin' && role !== 'staff') {
      // Agents and other roles cannot access agreement workflows
      return sendError(res, 'Access denied. Unauthorized role.', 403);
    }

    // Attach application to request for downstream usage
    req.loanApplication = application;
    next();
  } catch (error) {
    return sendError(res, 'Validation error: ' + error.message, 500);
  }
};

module.exports = {
  validateAgreementAccess,
};

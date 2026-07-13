const Agent = require('../models/Agent');
const { sendError } = require('../utils/responseHandler');

/**
 * Middleware to check if an agent is active before allowing operational actions.
 * Use this on routes like create borrower, process payment, etc.
 */
exports.restrictInactiveAgent = async (req, res, next) => {
  // Only apply to users with 'agent' role
  if (req.user.role !== 'agent') {
    return next();
  }

  try {
    const agent = await Agent.findOne({ userId: req.user._id });

    if (!agent) {
      return sendError(res, 'Agent profile not found', 404);
    }

    if (agent.accountStatus === 'Inactive') {
      return sendError(res, 'Your account is inactive. Operational access is restricted.', 403);
    }

    if (agent.accountStatus === 'Suspended') {
      return sendError(res, 'Your account has been suspended', 403);
    }

    next();
  } catch (error) {
    console.error('Agent Status Check Error:', error);
    sendError(res, 'Internal Server Error', 500);
  }
};

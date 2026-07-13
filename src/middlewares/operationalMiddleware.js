const Staff = require('../models/Staff');
const Agent = require('../models/Agent');
const { sendError } = require('../utils/responseHandler');

/**
 * Middleware to block Inactive staff/agents from performing operational actions.
 * Operational actions include: verifying documents, processing applications, adding notes, etc.
 */
const restrictInactive = async (req, res, next) => {
  const { role, _id: userId } = req.user;

  try {
    let status;
    
    if (role === 'staff') {
      const staff = await Staff.findOne({ userId });
      status = staff?.status;
    } else if (role === 'agent') {
      const agent = await Agent.findOne({ userId });
      status = agent?.accountStatus;
    } else {
      // Admins and other roles are not restricted by this middleware
      return next();
    }

    if (status === 'Inactive') {
      return sendError(res, 'Your account is currently inactive. Operational actions are temporarily disabled.', 403);
    }

    if (status === 'Suspended') {
      return sendError(res, 'Your account has been suspended', 403);
    }

    next();
  } catch (error) {
    console.error('Status Check Error:', error);
    next(error);
  }
};

module.exports = { restrictInactive };

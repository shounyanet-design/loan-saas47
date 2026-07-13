const { sendError } = require('../utils/responseHandler');

/**
 * @desc    Middleware to restrict access to specific roles
 * @param   {...string} roles - List of allowed roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(
        res,
        `Unauthorized: Your account does not have ${roles.join(' or ')} privileges`,
        403
      );
    }
    next();
  };
};

module.exports = { authorize };

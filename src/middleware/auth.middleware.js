/**
 * Verification Router Authentication Middleware
 * Validates JWT access authorization and loads the requesting entity.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const tenantContext = require('../tenancy/tenantContext');

/**
 * Secures verification initiation endpoints against unauthorized access
 */
const protectVerification = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (authHeader && authHeader.startsWith('Bearer')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized: Access token is missing or malformed'
    });
  }

  try {
    // Verify token expiration and payload validation
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'point47_super_secret_key');

    // Retrieve active user profile in SYSTEM mode (auth bootstrap — tenant not
    // yet established), then resolve tenant from the DB record.
    req.user = await tenantContext.runAsSystem(() => User.findById(decoded.id));

    if (!req.user) {
      return res.status(404).json({
        success: false,
        message: 'Not authorized: User context could not be found'
      });
    }

    if (!req.user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Requesting account status is suspended'
      });
    }

    if (!req.user.tenantId) {
      // Self-heal a tenant-less account once (unambiguous tenant only).
      const { healUserTenant, NO_TENANT_MESSAGE } = require('../tenancy/tenantHealing');
      const heal = await healUserTenant(req.user);
      if (!heal.healed) {
        return res.status(403).json({
          success: false,
          message: heal.reason || NO_TENANT_MESSAGE
        });
      }
    }
    req.tenantId = req.user.tenantId;

    // Hand off to controller inside the tenant context.
    return tenantContext.runWithTenant(req.user.tenantId, () => next());
  } catch (error) {
    console.error('❌ [Auth Verification Middleware Error]:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized: Authentication signature is invalid or expired'
    });
  }
};

module.exports = {
  protectVerification
};

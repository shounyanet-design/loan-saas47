const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/responseHandler');
const PlatformUser = require('../modules/platform/models/PlatformUser');
const tenantContext = require('../tenancy/tenantContext');

/**
 * Super Admin authentication + authorization.
 *
 * SECURITY MODEL:
 *  - Accepts ONLY platform-scoped tokens (`scope: 'platform'`). A tenant token
 *    (which has no such scope) is rejected, so tenant users can never reach
 *    platform APIs.
 *  - Loads the PlatformUser from the DB and requires an active SUPER_ADMIN.
 *  - Runs the remainder of the request inside `runAsSystem()` so platform-wide
 *    (cross-tenant) reads work. Tenant isolation is NOT disabled — SYSTEM mode
 *    is the existing, audited bypass used only here for the platform owner.
 *  - A platform token used against a tenant route fails the tenant `protect`
 *    middleware (no matching tenant User), so the two worlds stay separate.
 */
async function protectPlatform(req, res, next) {
  try {
    let token;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.platformToken) {
      token = req.cookies.platformToken;
    }
    if (!token) return sendError(res, 'Not authorized: No platform token provided', 401);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope !== 'platform') {
      return sendError(res, 'Not authorized: not a platform token', 401);
    }

    const platformUser = await PlatformUser.findById(decoded.id);
    if (!platformUser) return sendError(res, 'Platform user not found', 404);
    if (!platformUser.isActive) return sendError(res, 'Platform account is disabled', 403);
    if (platformUser.role !== 'SUPER_ADMIN') {
      return sendError(res, 'Forbidden: SUPER_ADMIN role required', 403);
    }

    req.platformUser = platformUser;
    // Platform-wide access: run the rest of the request in SYSTEM mode.
    return tenantContext.runAsSystem(() => next());
  } catch (err) {
    console.error('Platform Auth Error:', err.message);
    return sendError(res, 'Not authorized: Invalid or expired platform token', 401);
  }
}

/** Require one or more fine-grained permissions on the platform user. */
function requirePermission(...perms) {
  return (req, res, next) => {
    const have = (req.platformUser && req.platformUser.permissions) || [];
    const ok = perms.every((p) => have.includes(p));
    if (!ok) return sendError(res, `Forbidden: missing permission(s) ${perms.join(', ')}`, 403);
    next();
  };
}

module.exports = { protectPlatform, requirePermission };

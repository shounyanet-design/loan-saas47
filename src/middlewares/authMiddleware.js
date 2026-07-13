const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const { sendError } = require('../utils/responseHandler');
const User = require('../models/User');
const tenantContext = require('../tenancy/tenantContext');

const protect = async (req, res, next) => {
  try {
    let token;

    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (
      authHeader &&
      authHeader.startsWith('Bearer')
    ) {
      // Set token from Bearer token in header
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      // Set token from cookie
      token = req.cookies.token;
    }

    // Make sure token exists
    if (!token) {
      return sendError(res, 'Not authorized: No token provided', 401);
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Resolve the user in SYSTEM mode: we do not yet have a tenant context, and
    // the lookup is what tells us which tenant the user belongs to. This avoids
    // the fail-closed plugin throwing during auth bootstrap.
    req.user = await tenantContext.runAsSystem(() => User.findById(decoded.id));

    if (!req.user) {
        return sendError(res, 'User not found', 404);
    }

    // Check if user is suspended/inactive at authentication level
    if (!req.user.isActive) {
      return sendError(res, 'Your account has been suspended', 403);
    }

    // Tenant is ALWAYS resolved from the database record (authoritative source),
    // never trusted from the request. Works for both new tokens (which also
    // carry tenantId) and legacy tokens issued before tenant support existed.
    let tenantId = req.user.tenantId;
    if (!tenantId) {
      // Self-heal a tenant-less account (legacy/seeded/imported) ONCE, instead
      // of permanently 403-ing valid logins. Only succeeds when the tenant is
      // unambiguous; otherwise a meaningful (non-generic) error is returned.
      const { healUserTenant, NO_TENANT_MESSAGE } = require('../tenancy/tenantHealing');
      const heal = await healUserTenant(req.user);
      if (!heal.healed) {
        return sendError(res, heal.reason || NO_TENANT_MESSAGE, 403);
      }
      tenantId = req.user.tenantId;
    }
    req.tenantId = tenantId;

    // Check if tenant is active/suspended
    const Tenant = require('../models/Tenant');
    const tenant = await tenantContext.runAsSystem(() => Tenant.findById(tenantId));
    if (!tenant) {
      return sendError(res, 'Tenant account not found', 404);
    }
    if (tenant.status === 'suspended') {
      return sendError(res, 'Your organization account has been suspended. Please contact support.', 403);
    }
    if (tenant.status === 'disabled') {
      return sendError(res, 'Your organization account is disabled.', 403);
    }
    if (tenant.status === 'expired') {
      return sendError(res, 'Your organization subscription has expired.', 403);
    }

    // Run the remainder of the request pipeline inside the tenant context so
    // every tenant-scoped query downstream is filtered automatically.
    return tenantContext.runWithTenant(tenantId, () => next());
  } catch (err) {
    console.error('Auth Middleware Error:', err.message);
    return sendError(res, 'Not authorized: Invalid or expired token', 401);
  }
};


module.exports = { protect };

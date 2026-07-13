const tenantContext = require('../tenancy/tenantContext');
const { sendError } = require('../utils/responseHandler');

/**
 * Tenant Middleware
 * -----------------
 * Establishes the AsyncLocalStorage tenant context for the remainder of an
 * authenticated request, so every tenant-scoped query downstream is filtered
 * automatically by the tenant plugin.
 *
 * SECURITY: the tenantId is taken from `req.tenantId` which `protect` derives
 * from the authenticated user's DATABASE record (and JWT) — never from the
 * request body, query string or headers.
 *
 * Usage (already wired through `protect`, but available standalone):
 *   router.get('/x', protect, tenantMiddleware, controller)
 */
async function tenantMiddleware(req, res, next) {
  let tenantId = req.tenantId || (req.user && req.user.tenantId);
  if (!tenantId && req.user) {
    // Self-heal a tenant-less account once (unambiguous tenant only).
    const { healUserTenant, NO_TENANT_MESSAGE } = require('../tenancy/tenantHealing');
    const heal = await healUserTenant(req.user);
    if (heal.healed) tenantId = req.user.tenantId;
    else return sendError(res, heal.reason || NO_TENANT_MESSAGE, 403);
  }
  if (!tenantId) {
    return sendError(res, 'Tenant could not be resolved for this account', 403);
  }
  // Run the rest of the request pipeline inside the tenant context.
  return tenantContext.runWithTenant(tenantId, () => next());
}

module.exports = { tenantMiddleware };

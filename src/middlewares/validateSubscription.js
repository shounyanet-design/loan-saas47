const Tenant = require('../models/Tenant');
const tenantContext = require('../tenancy/tenantContext');
const { getEffectiveConfig } = require('../modules/saas/services/subscriptionService');
const { checkLimit } = require('../modules/saas/services/limitService');
const usageService = require('../modules/saas/services/usageService');

/**
 * License / subscription guard. Mount AFTER `protect` (tenant context +
 * req.tenantId established).
 *
 * Checks (cheap, on every call): tenant active / not suspended / archived /
 * disabled, subscription active / trial not expired.
 * Optional (per-mount): feature gate, API-call limit, storage limit, metering.
 *
 * BACKWARD COMPATIBILITY: tenants with no subscription are "grandfathered"
 * (treated as active/unlimited) so existing installs are never blocked.
 *
 * @param {object} [opts] { feature, checkApiLimit, checkStorage, meter }
 */
function validateSubscription(opts = {}) {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenantId || (req.user && req.user.tenantId);
      if (!tenantId) {
        return res.status(403).json({ success: false, code: 'NO_TENANT', message: 'No tenant context' });
      }

      // 1. Tenant status
      const tenant = await tenantContext.runAsSystem(() => Tenant.findById(tenantId).lean());
      if (!tenant) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
      if (tenant.status === 'suspended') return res.status(403).json({ success: false, code: 'TENANT_SUSPENDED', message: 'This account has been suspended. Please contact support.' });
      if (tenant.status === 'archived' || tenant.status === 'disabled') return res.status(403).json({ success: false, code: 'TENANT_DISABLED', message: 'This account is no longer active.' });

      // 2. Subscription status
      const cfg = await getEffectiveConfig({ tenantId });
      if (!cfg.grandfathered) {
        if (cfg.status === 'expired') return res.status(402).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', message: 'Your subscription has expired. Please renew to continue.' });
        if (cfg.status === 'canceled') return res.status(402).json({ success: false, code: 'SUBSCRIPTION_CANCELED', message: 'Your subscription was canceled.' });
        if (cfg.status === 'suspended') return res.status(403).json({ success: false, code: 'SUBSCRIPTION_SUSPENDED', message: 'Your subscription is suspended.' });
        if (!cfg.isActive) return res.status(402).json({ success: false, code: 'SUBSCRIPTION_INACTIVE', message: 'Your subscription is not active.' });
      }

      // 3. Optional feature gate
      if (opts.feature && cfg.features !== null && !cfg.features.has(opts.feature)) {
        return res.status(403).json({ success: false, code: 'FEATURE_NOT_ENABLED', message: `The "${opts.feature}" feature is not enabled on your plan.` });
      }

      // 4. Optional API-call limit
      if (opts.checkApiLimit) {
        const r = await checkLimit('api', 1, { tenantId });
        if (!r.allowed) return res.status(429).json({ success: false, code: 'API_LIMIT_EXCEEDED', message: `Monthly API call limit (${r.limit}) reached.`, limit: r.limit, current: r.current });
      }

      // 5. Optional storage limit
      if (opts.checkStorage) {
        const r = await checkLimit('storageGB', 0, { tenantId });
        if (!r.allowed) return res.status(507).json({ success: false, code: 'STORAGE_EXCEEDED', message: `Storage limit (${r.limit} GB) exceeded.` });
      }

      // 6. Optional metering (fire-and-forget — never blocks the request)
      if (opts.meter) {
        usageService.record({ tenantId, service: 'api', action: `${req.method} ${req.baseUrl || ''}${req.path || ''}`, provider: 'platform' }).catch(() => {});
      }

      return next();
    } catch (err) {
      console.error('[validateSubscription] error:', err.message);
      // Fail-open on internal errors to avoid breaking the LMS on a guard bug.
      return next();
    }
  };
}

module.exports = validateSubscription;

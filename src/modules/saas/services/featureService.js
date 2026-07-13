const { getEffectiveConfig } = require('./subscriptionService');
const tenantContext = require('../../../tenancy/tenantContext');
const { sendError } = require('../../../utils/responseHandler');

/**
 * Feature Flag Engine.
 *
 * Canonical feature keys. A plan enables a subset via enabledModules /
 * enabledFeatures / enabledIntegrations. Controllers ask `hasFeature(key)`;
 * routes can gate with the `requireFeature(key)` middleware. Nothing is
 * hardcoded — availability is derived from the tenant's plan.
 */
const FEATURES = [
  'LOANS', 'BORROWERS', 'STAFF', 'AGENTS',
  'FACE_VERIFICATION', 'OCR', 'AML', 'CREDIT_BUREAU', 'PHONE_VERIFICATION', 'BANK_VERIFICATION',
  'SMS', 'EMAIL', 'REPORTS', 'EXPORT', 'DASHBOARD', 'API', 'SETTINGS',
  'MARKETPLACE', 'WALLET', 'BILLING',
];

/** Load a tenant's feature overrides map ({FEATURE: bool}) — SYSTEM mode, lean. */
async function loadOverrides(tenantId) {
  if (!tenantId) return {};
  const Tenant = require('../../../models/Tenant');
  const t = await tenantContext.runAsSystem(() =>
    Tenant.findById(tenantId).select('featureOverrides').lean()
  );
  return (t && t.featureOverrides) || {};
}

/**
 * Resolve the effective features for a tenant = plan-derived set with per-tenant
 * overrides applied on top (override wins). Returns the building blocks so callers
 * can report each feature's source (override vs plan vs default).
 *
 * @param {object} [opts] - { tenantId }. If omitted, uses the ambient tenant context.
 * @returns {Promise<{ planEnabled:Set, overrides:object, enabled:Set }>}
 */
async function resolveFeatures(opts = {}) {
  const cfg = await getEffectiveConfig(opts);
  // Plan-derived base set. `features === null` (grandfathered) => everything.
  const planEnabled = cfg.features === null
    ? new Set(FEATURES)
    : new Set(FEATURES.filter((f) => cfg.features.has(f)));

  const tenantId = opts.tenantId || tenantContext.getTenantId();
  const overrides = await loadOverrides(tenantId);

  const enabled = new Set(planEnabled);
  for (const f of FEATURES) {
    if (Object.prototype.hasOwnProperty.call(overrides, f)) {
      if (overrides[f]) enabled.add(f); else enabled.delete(f);
    }
  }
  return { planEnabled, overrides, enabled };
}

/**
 * @param {string} feature - canonical feature key
 * @param {object} [opts] - { tenantId } for explicit/SYSTEM-mode lookups
 * @returns {Promise<boolean>}
 */
async function hasFeature(feature, opts = {}) {
  const { enabled } = await resolveFeatures(opts);
  return enabled.has(feature);
}

/** Return the set of enabled feature keys for the tenant (plan + overrides). */
async function getEnabledFeatures(opts = {}) {
  const { enabled } = await resolveFeatures(opts);
  return FEATURES.filter((f) => enabled.has(f));
}

/**
 * Express middleware: block the route unless the tenant's plan enables `feature`.
 * Must run after `protect` (tenant context established).
 */
function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const ok = await hasFeature(feature, req.tenantId ? { tenantId: req.tenantId } : {});
      if (!ok) {
        return res.status(403).json({
          success: false,
          code: 'FEATURE_NOT_ENABLED',
          message: `The "${feature}" feature is not enabled on your current plan.`,
        });
      }
      next();
    } catch (err) {
      return sendError(res, 'Feature check failed', 500);
    }
  };
}

module.exports = { FEATURES, hasFeature, getEnabledFeatures, resolveFeatures, requireFeature };

const { getEffectiveConfig, UNLIMITED } = require('./subscriptionService');
const usageService = require('./usageService');

// Entity-count limits map to a model; usage-based limits map to UsageRecord.
const ENTITY_MODELS = {
  staff: 'Staff',
  borrowers: 'Borrower',
  loans: 'Loan',
  documents: 'LoanDocument',
};
const USAGE_SERVICES = {
  api: 'api', sms: 'sms', email: 'email', ocr: 'ocr', aml: 'aml',
  credit_bureau: 'credit_bureau', facetec: 'facetec', storageGB: 'storage',
};

function isUnlimited(limit) {
  return limit == null || limit === UNLIMITED;
}

/**
 * Check whether `increment` more of `resource` is permitted for the tenant.
 * @returns {Promise<{allowed:boolean, limit:number, current:number, remaining:number, unlimited:boolean, resource:string}>}
 */
async function checkLimit(resource, increment = 1, opts = {}) {
  const cfg = await getEffectiveConfig(opts);
  // Grandfathered tenants are unlimited.
  const limit = cfg.limits ? cfg.limits[resource] : UNLIMITED;

  if (cfg.grandfathered || isUnlimited(limit)) {
    return { allowed: true, unlimited: true, limit: UNLIMITED, current: 0, remaining: Infinity, resource };
  }

  let current = 0;
  if (ENTITY_MODELS[resource]) {
    const Model = require('mongoose').model(ENTITY_MODELS[resource]);
    // Runs in the ambient tenant context (auto-scoped) or explicit tenantId.
    current = opts.tenantId
      ? await require('../../../tenancy/tenantContext').runAsSystem(() => Model.countDocuments({ tenantId: opts.tenantId }))
      : await Model.countDocuments({});
  } else if (USAGE_SERVICES[resource]) {
    let units = await usageService.countInPeriod(USAGE_SERVICES[resource], opts);
    if (resource === 'storageGB') units = units / 1024; // storage tracked in MB
    current = units;
  }

  const allowed = current + increment <= limit;
  return { allowed, unlimited: false, limit, current, remaining: Math.max(0, limit - current), resource };
}

/** Usage-vs-limit report for every limited resource. */
async function getUsageVsLimits(opts = {}) {
  const resources = [...Object.keys(ENTITY_MODELS), ...Object.keys(USAGE_SERVICES)];
  const out = {};
  for (const r of resources) {
    // eslint-disable-next-line no-await-in-loop
    out[r] = await checkLimit(r, 0, opts);
  }
  return out;
}

/**
 * Express middleware: enforce a create limit. Mount on create endpoints.
 * Must run after `protect` (tenant context established).
 */
function enforceLimit(resource, increment = 1) {
  return async (req, res, next) => {
    try {
      const result = await checkLimit(resource, increment, req.tenantId ? { tenantId: req.tenantId } : {});
      if (!result.allowed) {
        return res.status(403).json({
          success: false,
          code: 'LIMIT_EXCEEDED',
          message: `Your plan limit for "${resource}" (${result.limit}) has been reached.`,
          limit: result.limit,
          current: result.current,
        });
      }
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Limit check failed' });
    }
  };
}

module.exports = { checkLimit, getUsageVsLimits, enforceLimit, ENTITY_MODELS, USAGE_SERVICES };

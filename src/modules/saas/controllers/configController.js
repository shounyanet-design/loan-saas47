const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const TenantSettings = require('../../../models/TenantSettings');
const TenantApiSettings = require('../../../models/TenantApiSettings');
const tenantContext = require('../../../tenancy/tenantContext');
const usageService = require('../services/usageService');
const { getEffectiveConfig } = require('../services/subscriptionService');
const { getUsageVsLimits } = require('../services/limitService');
const { FEATURES, resolveFeatures } = require('../services/featureService');
const Tenant = require('../../../models/Tenant');
const credentialService = require('../services/credentialService');
const { audit } = require('../utils/auditAny');

// tenantId from route param (platform) or request context (tenant self).
const tid = (req) => req.params.tenantId || req.tenantId;

async function getSettings(tenantId) {
  return tenantContext.runAsSystem(async () => {
    let doc = await TenantSettings.findOne({ tenantId });
    if (!doc) doc = await TenantSettings.create({ tenantId });
    return doc;
  });
}

const BRANDING_FIELDS = ['logo', 'darkLogo', 'favicon', 'primaryColor', 'secondaryColor', 'accentColor', 'theme',
  'fontFamily', 'footer', 'copyright', 'dashboardBranding',
  'companyName', 'companyEmail', 'supportEmail', 'supportPhone', 'address', 'website', 'loginBackground',
  'emailHeader', 'emailFooter', 'smsSignature', 'termsUrl', 'privacyUrl'];

// ---------------- USAGE ----------------
exports.getUsage = asyncHandler(async (req, res) => {
  const tenantId = tid(req);
  const [summary, vsLimits] = await Promise.all([
    usageService.getSummary({ tenantId }),
    getUsageVsLimits({ tenantId }),
  ]);
  return sendSuccess(res, 'Usage', { summary, limits: vsLimits, period: usageService.periodStart() });
});

// Platform-wide usage (all tenants) — protectPlatform already in SYSTEM mode.
exports.getPlatformUsage = asyncHandler(async (req, res) => {
  const summary = await usageService.getSummary({});
  return sendSuccess(res, 'Platform usage', { summary, period: usageService.periodStart() });
});

// ---------------- BRANDING ----------------
exports.getBranding = asyncHandler(async (req, res) => {
  const doc = await getSettings(tid(req));
  return sendSuccess(res, 'Branding', doc.branding || {});
});

exports.updateBranding = asyncHandler(async (req, res) => {
  const tenantId = tid(req);
  const doc = await getSettings(tenantId);
  const before = { ...(doc.branding || {}) };
  doc.branding = doc.branding || {};
  BRANDING_FIELDS.forEach((f) => { if (req.body[f] !== undefined) doc.branding[f] = req.body[f]; });
  await tenantContext.runAsSystem(() => doc.save());
  await audit(req, { action: 'BRANDING_UPDATED', entity: 'TenantSettings', entityId: tenantId, oldValues: before, newValues: doc.branding });
  return sendSuccess(res, 'Branding updated', doc.branding);
});

// ---------------- FEATURE AVAILABILITY ----------------
exports.featureCatalog = asyncHandler(async (req, res) => sendSuccess(res, 'Feature catalog', FEATURES));

// Build the per-feature availability list with source attribution.
async function buildAvailability(tenantId) {
  const { planEnabled, overrides, enabled } = await resolveFeatures({ tenantId });
  return FEATURES.map((f) => ({
    feature: f,
    enabled: enabled.has(f),
    planEnabled: planEnabled.has(f),
    source: Object.prototype.hasOwnProperty.call(overrides, f) ? 'override' : (planEnabled.has(f) ? 'plan' : 'default'),
  }));
}

exports.featureAvailability = asyncHandler(async (req, res) => {
  return sendSuccess(res, 'Feature availability', await buildAvailability(tid(req)));
});

// Set or clear per-tenant overrides. Two body forms (override wins over plan):
//   Single: { feature, enabled }   — enabled true|false to override, null to reset
//   Bulk:   { overrides: { FEATURE: true|false|null, ... } } — for enable/disable-all
exports.setFeatureOverride = asyncHandler(async (req, res) => {
  const tenantId = req.params.tenantId;
  const { feature, enabled, overrides } = req.body;

  // Validate everything up front (before any DB write).
  const patch = {};
  const VALID = (v) => v === true || v === false || v === null;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [k, v] of Object.entries(overrides)) {
      if (!FEATURES.includes(k)) return sendError(res, `Unknown feature "${k}"`, 400);
      if (!VALID(v)) return sendError(res, `Invalid value for "${k}" (use true/false/null)`, 400);
      patch[k] = v;
    }
  } else {
    if (!FEATURES.includes(feature)) return sendError(res, `Unknown feature "${feature}"`, 400);
    if (!VALID(enabled)) return sendError(res, 'enabled must be true, false, or null (reset)', 400);
    patch[feature] = enabled;
  }

  // Normalize: an override that EQUALS the plan's value isn't a real divergence,
  // so drop it (the feature inherits from the plan and shows "Plan", not "Override").
  const { planEnabled } = await resolveFeatures({ tenantId });
  for (const k of Object.keys(patch)) {
    if (patch[k] !== null && patch[k] === planEnabled.has(k)) patch[k] = null;
  }

  await tenantContext.runAsSystem(async () => {
    const t = await Tenant.findById(tenantId);
    if (!t) { const e = new Error('Tenant not found'); e.statusCode = 404; throw e; }
    const ov = { ...(t.featureOverrides || {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete ov[k]; else ov[k] = v; }
    t.featureOverrides = ov;
    t.markModified('featureOverrides');
    await t.save();
  });

  await audit(req, { action: 'FEATURE_OVERRIDE_SET', entity: 'Tenant', entityId: tenantId, newValues: patch });
  return sendSuccess(res, 'Feature override updated', await buildAvailability(tenantId));
});

// Clear ALL per-tenant overrides (reset every feature to the plan).
exports.resetFeatureOverrides = asyncHandler(async (req, res) => {
  const tenantId = req.params.tenantId;
  await tenantContext.runAsSystem(async () => {
    const t = await Tenant.findById(tenantId);
    if (!t) throw Object.assign(new Error('Tenant not found'), { status: 404 });
    t.featureOverrides = {};
    t.markModified('featureOverrides');
    await t.save();
  });
  await audit(req, { action: 'FEATURE_OVERRIDES_RESET', entity: 'Tenant', entityId: tenantId });
  return sendSuccess(res, 'Feature overrides reset to plan', await buildAvailability(tenantId));
});

// ---------------- LICENSE ----------------
exports.getLicense = asyncHandler(async (req, res) => {
  const tenantId = tid(req);
  const cfg = await getEffectiveConfig({ tenantId });
  const vsLimits = await getUsageVsLimits({ tenantId });
  return sendSuccess(res, 'License', {
    status: cfg.status,
    isActive: cfg.isActive,
    isTrialing: cfg.isTrialing,
    isExpired: cfg.isExpired,
    grandfathered: cfg.grandfathered,
    plan: cfg.plan ? { name: cfg.plan.name, code: cfg.plan.code } : null,
    subscription: cfg.subscription,
    limits: vsLimits,
  });
});

// ---------------- API SETTINGS (credentials) ----------------
exports.getApiSettings = asyncHandler(async (req, res) => {
  const data = await credentialService.getMaskedSettings(tid(req));
  return sendSuccess(res, 'API settings (masked)', data);
});

exports.updateProvider = asyncHandler(async (req, res) => {
  const tenantId = tid(req);
  const { provider } = req.params;
  if (!TenantApiSettings.PROVIDERS.includes(provider)) return sendError(res, 'Unknown provider', 400);
  const { credentials, enabled, mode } = req.body;
  const masked = await credentialService.setProviderCredentials(tenantId, provider, { credentials, enabled, mode });
  await audit(req, { action: 'API_CREDENTIALS_UPDATED', entity: 'TenantApiSettings', entityId: tenantId, newValues: { provider, enabled, mode, keys: Object.keys(credentials || {}) } });
  return sendSuccess(res, 'Provider updated', { provider, ...masked });
});

exports.testProvider = asyncHandler(async (req, res) => {
  const result = await credentialService.testConnection(tid(req), req.params.provider);
  await audit(req, { action: 'API_CREDENTIALS_TESTED', entity: 'TenantApiSettings', entityId: tid(req), newValues: { provider: req.params.provider, ok: result.ok } });
  return sendSuccess(res, 'Connection test', result);
});

const TenantSubscription = require('../../../models/TenantSubscription');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const tenantContext = require('../../../tenancy/tenantContext');

/**
 * Resolve the effective subscription configuration for a tenant.
 *
 * Works in tenant context (omit tenantId — the plugin scopes the query) or in
 * SYSTEM mode (pass tenantId for an explicit lookup).
 *
 * BACKWARD COMPATIBILITY: if a tenant has no subscription, a "grandfathered"
 * effective config is returned — all features enabled, unlimited limits, status
 * active — so existing installs are never blocked.
 */
const UNLIMITED = -1;

function grandfathered() {
  return {
    grandfathered: true,
    subscription: null,
    plan: null,
    status: 'active',
    isActive: true,
    isTrialing: false,
    isExpired: false,
    features: null, // null => treat as "all features enabled"
    limits: {}, // empty => unlimited
  };
}

async function getEffectiveConfig({ tenantId } = {}) {
  // When an explicit tenantId is provided (middleware, platform, cron, tests),
  // run the tenant-scoped lookup in SYSTEM mode so it works outside a request
  // context. When omitted, rely on the ambient tenant context (plugin scopes).
  const sub = tenantId
    ? await tenantContext.runAsSystem(() => TenantSubscription.findOne({ tenantId }))
    : await TenantSubscription.findOne({});
  if (!sub) return grandfathered();

  const plan = await SubscriptionPlan.findById(sub.planId).lean();
  if (!plan) return grandfathered();

  const now = Date.now();
  const trialExpired = sub.trialEnd ? now > new Date(sub.trialEnd).getTime() : false;
  const periodExpired = sub.subscriptionEnd ? now > new Date(sub.subscriptionEnd).getTime() : false;

  let status = sub.status;
  // Derive expiry without mutating the DB here (a cron/job handles transitions).
  if ((status === 'trialing' && trialExpired) || (status === 'active' && periodExpired)) {
    status = 'expired';
  }
  const isTrialing = status === 'trialing' && !trialExpired;
  const isActive = status === 'active' || isTrialing;

  const features = new Set([
    ...(plan.enabledModules || []),
    ...(plan.enabledFeatures || []),
    ...(plan.enabledIntegrations || []),
  ]);

  const limits = {
    staff: plan.maximumStaff,
    borrowers: plan.maximumBorrowers,
    loans: plan.maximumLoans,
    branches: plan.maximumBranches,
    documents: plan.maximumDocuments,
    storageGB: plan.maximumStorageGB,
    api: plan.maximumApiCalls,
    sms: plan.maximumSms,
    email: plan.maximumEmails,
    ocr: plan.maximumOcr,
    aml: plan.maximumAml,
    credit_bureau: plan.maximumCreditReports,
    facetec: plan.maximumFaceVerifications,
  };

  return {
    grandfathered: false,
    subscription: sub,
    plan,
    status,
    isActive,
    isTrialing,
    isExpired: status === 'expired',
    features,
    limits,
  };
}

module.exports = { getEffectiveConfig, UNLIMITED };

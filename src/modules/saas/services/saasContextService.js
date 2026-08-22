const Tenant = require('../../../models/Tenant');
const TenantSettings = require('../../../models/TenantSettings');
const TenantDomain = require('../../../models/TenantDomain');
const tenantContext = require('../../../tenancy/tenantContext');
const { getEffectiveConfig } = require('./subscriptionService');
const { getUsageVsLimits } = require('./limitService');
const { resolveFeatures } = require('./featureService');
const walletService = require('../../commerce/services/walletService');

const mongoose = require('mongoose');

/**
 * Unified SaaS Context Service
 * ----------------------------
 * Consolidates tenant profile, active subscription, plan details, resolved features,
 * resource limits, wallet balance summary, branding, and custom domain into a single
 * authoritative response for the Tenant Admin interface.
 */
async function getSaasContext(tenantId) {
  if (!tenantId || mongoose.connection.readyState !== 1) return null;

  return tenantContext.runAsSystem(async () => {
    const [tenant, config, usageLimits, features, wallet, settings, domain] = await Promise.all([
      Tenant.findById(tenantId).lean(),
      getEffectiveConfig({ tenantId }),
      getUsageVsLimits({ tenantId }),
      resolveFeatures(tenantId),
      walletService.getOrCreate(tenantId),
      TenantSettings.findOne({ tenantId }).lean(),
      TenantDomain.findOne({ tenantId, status: 'ACTIVE' }).lean(),
    ]);

    if (!tenant) return null;

    const featureList = features instanceof Set ? Array.from(features) : (Array.isArray(features) ? features : []);

    return {
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        isDefault: !!tenant.isDefault,
        createdAt: tenant.createdAt,
      },
      subscription: {
        planId: config?.planId || null,
        planName: config?.planName || 'Standard',
        status: config?.status || 'active',
        isActive: config?.isActive !== false,
        trialEnd: config?.trialEnd || null,
        subscriptionEnd: config?.subscriptionEnd || null,
        billingCycle: config?.billingCycle || 'monthly',
        monthlyPrice: config?.monthlyPrice || 0,
        grandfathered: !!config?.grandfathered,
      },
      features: featureList,
      limits: usageLimits || {},
      wallet: {
        availableTokens: wallet?.availableTokens || 0,
        reservedTokens: wallet?.reservedTokens || 0,
        consumedTokens: wallet?.consumedTokens || 0,
        purchasedTokens: wallet?.purchasedTokens || 0,
        bonusTokens: wallet?.bonusTokens || 0,
        lowBalanceThreshold: wallet?.lowBalanceThreshold || 100,
        isLowBalance: (wallet?.availableTokens || 0) <= (wallet?.lowBalanceThreshold || 100),
      },
      capabilities: {
        customCredentialsAllowed: featureList.includes('TENANT_API_CREDENTIALS') || !!config?.grandfathered,
        customDomainAllowed: featureList.includes('CUSTOM_DOMAIN') || !!config?.grandfathered,
        marketplaceAllowed: featureList.includes('MARKETPLACE') || true,
        creditBureauAllowed: featureList.includes('CREDIT_BUREAU') || true,
        amlAllowed: featureList.includes('AML') || true,
        bankAvsAllowed: featureList.includes('BANK_VERIFICATION') || true,
        realpayAllowed: featureList.includes('REALPAY') || true,
      },
      branding: settings?.branding || {},
      customDomain: domain?.domain || null,
    };
  });
}

module.exports = {
  getSaasContext,
};

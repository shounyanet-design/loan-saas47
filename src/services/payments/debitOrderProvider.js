const realpayService = require('../realpay/realpayService');
const nupayService = require('../nupayService');
const credentialService = require('../../modules/saas/services/credentialService');
const tenantContext = require('../../tenancy/tenantContext');

/**
 * Unified Debit Order / DebiCheck Provider Abstraction
 * Resolves active provider (REALPAY vs NUPAY) dynamically.
 */
class DebitOrderProvider {
  /**
   * Determine the active provider name for a tenant.
   * Priority:
   * 1. Tenant settings `providers.debitOrder`
   * 2. Global process.env.DEBIT_ORDER_PROVIDER
   * 3. Default: 'REALPAY'
   */
  async resolveProviderName(tenantId = null) {
    const activeTenantId = tenantId || tenantContext.getTenantId();
    if (activeTenantId) {
      try {
        const settings = await credentialService.getSettings(activeTenantId);
        const tenantProvider = settings?.providers?.get?.('debitOrder')?.credentials?.get?.('provider');
        if (tenantProvider) {
          return tenantProvider.toLowerCase();
        }
      } catch {
        // Fall back to env
      }
    }

    const envProvider = (process.env.DEBIT_ORDER_PROVIDER || 'REALPAY').toLowerCase();
    return envProvider;
  }

  /**
   * Initiate DebiCheck Mandate via active provider.
   */
  async initiateMandate(payload, tenantId = null) {
    const providerName = await this.resolveProviderName(tenantId);
    
    if (providerName === 'nupay') {
      const result = await nupayService.initiateMandate(payload, tenantId);
      return {
        provider: 'NUPAY',
        ...result
      };
    }

    // Default to RealPay
    const result = await realpayService.initiateMandate(payload, tenantId);
    return {
      provider: 'REALPAY',
      ...result
    };
  }

  /**
   * Get mandate status.
   */
  async getMandateStatus(mandateId, providerHint = null, tenantId = null) {
    const providerName = providerHint ? providerHint.toLowerCase() : await this.resolveProviderName(tenantId);

    if (providerName === 'nupay') {
      const result = await nupayService.getMandateReport({ mandateID: mandateId }, tenantId);
      return { provider: 'NUPAY', ...result };
    }

    const result = await realpayService.getMandateStatus(mandateId, tenantId);
    return { provider: 'REALPAY', ...result };
  }

  /**
   * Cancel mandate.
   */
  async cancelMandate(mandateId, reason = '', tenantId = null) {
    const providerName = await this.resolveProviderName(tenantId);

    if (providerName === 'nupay') {
      return { provider: 'NUPAY', outcome: 'NOT_SUPPORTED_AUTOMATED', message: 'NuPay mandate cancellation requires manual process' };
    }

    const result = await realpayService.cancelMandate(mandateId, reason, tenantId);
    return { provider: 'REALPAY', ...result };
  }

  /**
   * Create collection / debit order charge.
   */
  async createCollection(payload, tenantId = null) {
    const providerName = await this.resolveProviderName(tenantId);

    if (providerName === 'nupay') {
      return { provider: 'NUPAY', outcome: 'ACCEPTED', message: 'NuPay collection scheduled via mandate' };
    }

    const result = await realpayService.createCollection(payload, tenantId);
    return { provider: 'REALPAY', ...result };
  }
}

module.exports = new DebitOrderProvider();

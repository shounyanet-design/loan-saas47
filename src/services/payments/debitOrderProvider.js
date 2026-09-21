const nupayService = require('../nupayService');

/**
 * Unified Debit Order / DebiCheck Provider Abstraction
 * Routes all mandate and debit order operations directly to NuPay.
 */
class DebitOrderProvider {
  /**
   * Active provider name is always NuPay.
   */
  async resolveProviderName() {
    return 'nupay';
  }

  /**
   * Initiate DebiCheck Mandate via NuPay.
   */
  async initiateMandate(payload, tenantId = null) {
    const result = await nupayService.initiateMandate(payload, tenantId);
    return {
      provider: 'NUPAY',
      ...result
    };
  }

  /**
   * Get mandate status via NuPay.
   */
  async getMandateStatus(mandateId, providerHint = null, tenantId = null) {
    const result = await nupayService.getMandateStatus(mandateId, tenantId);
    return { provider: 'NUPAY', ...result };
  }

  /**
   * Cancel mandate via NuPay.
   */
  async cancelMandate(mandateId, reason = '', tenantId = null) {
    const result = await nupayService.cancelMandate(mandateId, reason, tenantId);
    return { provider: 'NUPAY', ...result };
  }

  /**
   * Create collection / debit order charge via NuPay.
   */
  async createCollection(payload, tenantId = null) {
    const result = await nupayService.createCollection(payload, tenantId);
    return { provider: 'NUPAY', ...result };
  }
}

module.exports = new DebitOrderProvider();


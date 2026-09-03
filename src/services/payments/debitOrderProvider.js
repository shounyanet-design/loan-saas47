const realpayService = require('../realpay/realpayService');

/**
 * Unified Debit Order / DebiCheck Provider Abstraction
 * Routes all mandate and debit order operations directly to RealPay.
 */
class DebitOrderProvider {
  /**
   * Active provider name is always RealPay.
   */
  async resolveProviderName() {
    return 'realpay';
  }

  /**
   * Initiate DebiCheck Mandate via RealPay.
   */
  async initiateMandate(payload, tenantId = null) {
    const result = await realpayService.initiateMandate(payload, tenantId);
    return {
      provider: 'REALPAY',
      ...result
    };
  }

  /**
   * Get mandate status via RealPay.
   */
  async getMandateStatus(mandateId, providerHint = null, tenantId = null) {
    const result = await realpayService.getMandateStatus(mandateId, tenantId);
    return { provider: 'REALPAY', ...result };
  }

  /**
   * Cancel mandate via RealPay.
   */
  async cancelMandate(mandateId, reason = '', tenantId = null) {
    const result = await realpayService.cancelMandate(mandateId, reason, tenantId);
    return { provider: 'REALPAY', ...result };
  }

  /**
   * Create collection / debit order charge via RealPay.
   */
  async createCollection(payload, tenantId = null) {
    const result = await realpayService.createCollection(payload, tenantId);
    return { provider: 'REALPAY', ...result };
  }
}

module.exports = new DebitOrderProvider();

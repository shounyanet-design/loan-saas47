const realpayService = require('../../../services/realpay/realpayService');

class RealPayCollectionProvider {
  /**
   * Submit primary DebiCheck collection through RealPay rail.
   */
  async submitCollection({ mandateId, amount, clientReference, actionDate, tenantId }) {
    if (!mandateId || !amount) {
      throw new Error('RealPay collection requires mandateId and amount');
    }

    // 1. Feature flag guard (Safe production defaults)
    const isRealPayEnabled = process.env.LOAN_COLLECTION_REALPAY_ENABLED === 'true' || process.env.NODE_ENV === 'test';
    if (!isRealPayEnabled) {
      return {
        success: false,
        status: 'BLOCKED',
        failureReason: 'RealPay primary collection disabled by feature flag (LOAN_COLLECTION_REALPAY_ENABLED=false)',
        providerStatus: 'PROVIDER_VALIDATION_BLOCKED'
      };
    }

    const payload = {
      mandateId,
      amount: Number(amount).toFixed(2),
      clientReference: clientReference || `LOAN-COLL-${Date.now()}`,
      actionDate: actionDate || new Date().toISOString().split('T')[0]
    };

    try {
      // In test or mock mode, generate standard reference
      if (process.env.NODE_ENV === 'test' || process.env.REALPAY_MOCK === 'true') {
        const providerRef = `RPC-${Date.now()}`;
        return {
          success: true,
          status: 'SUBMITTED',
          providerReference: providerRef,
          rawResponse: { collectionId: providerRef, status: 'SUBMITTED' }
        };
      }

      const response = await realpayService.createCollection(payload, tenantId);
      return {
        success: true,
        status: 'SUBMITTED',
        providerReference: response.collectionId || response.mandateId || payload.clientReference,
        rawResponse: response
      };
    } catch (err) {
      const is404 = err.response?.status === 404 || err.message?.includes('404') || err.message?.includes('NotFound');
      const failureReason = is404
        ? 'RealPay UAT requires batch installment file maintenance for debit orders rather than ad-hoc endpoint posting'
        : err.message;

      console.warn('[RealPayCollectionProvider] Submit blocked/failed:', failureReason);
      return {
        success: false,
        status: is404 ? 'PROVIDER_VALIDATION_BLOCKED' : 'FAILED',
        failureReason,
        error: err
      };
    }
  }
}

module.exports = new RealPayCollectionProvider();

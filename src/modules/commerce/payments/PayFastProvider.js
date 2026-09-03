const IPaymentProvider = require('./IPaymentProvider');
const payfastService = require('../services/payfastService');

/**
 * PayFastProvider — implementation of IPaymentProvider interface for Payfast gateway.
 * Used by marketplace checkout when provider === 'payfast'.
 */
class PayFastProvider extends IPaymentProvider {
  constructor() {
    super('payfast');
  }

  /**
   * Create a payment intent / checkout request payload for Payfast.
   */
  async createCharge({ amount, currency = 'ZAR', invoice, tenantId, metadata = {} }) {
    const orderId = invoice.orderId || metadata.orderId;
    const userRef = metadata.userRef || metadata.placedBy;

    if (orderId) {
      const pfReq = await payfastService.createMarketplacePaymentRequest(tenantId, {
        orderId,
        amount,
        itemName: metadata.itemName || `Order ${orderId}`,
        userRef,
        sellerId: metadata.sellerId,
      });

      return {
        status: 'pending',
        providerRef: pfReq.mPaymentId,
        requiresExternalAction: true,
        redirectUrl: pfReq.actionUrl,
        payfastPayload: pfReq.payload,
      };
    }

    // Direct invoice payment fallback
    const cfg = payfastService.getPayfastConfig();
    const mPaymentId = `INV-${invoice._id}-${Date.now()}`;
    const payload = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      return_url: `${cfg.returnUrl}?type=invoice&invoiceId=${invoice._id}`,
      cancel_url: `${cfg.cancelUrl}?type=invoice&invoiceId=${invoice._id}`,
      notify_url: cfg.notifyUrl,
      m_payment_id: mPaymentId,
      amount: Number(amount).toFixed(2),
      item_name: `Invoice ${invoice.invoiceNumber || invoice._id}`,
      custom_str1: String(tenantId),
      custom_str2: 'marketplace',
    };

    if (cfg.passphrase && cfg.passphrase.trim() !== '') {
      payload.signature = payfastService.generateSignature(payload, cfg.passphrase);
    }

    return {
      status: 'pending',
      providerRef: mPaymentId,
      requiresExternalAction: true,
      redirectUrl: cfg.baseUrl,
      payfastPayload: payload,
    };
  }

  async capture(providerRef) {
    return { status: 'succeeded', providerRef };
  }

  async refund({ providerRef, amount, currency }) {
    return { status: 'completed', providerRef };
  }

  async verify(providerRef) {
    return { status: 'pending', providerRef };
  }
}

module.exports = PayFastProvider;

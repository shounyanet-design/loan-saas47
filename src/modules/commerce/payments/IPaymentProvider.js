/**
 * IPaymentProvider — the contract every payment adapter implements.
 * New providers plug in by implementing this interface and registering in
 * payments/index.js — no existing code changes (Open/Closed principle).
 */
class IPaymentProvider {
  constructor(name) { this.name = name; }

  /**
   * Create a charge for an invoice.
   * @returns {Promise<{status:'pending'|'succeeded'|'processing', providerRef:string, requiresExternalAction?:boolean, redirectUrl?:string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async createCharge({ amount, currency, invoice, tenantId, metadata }) {
    throw new Error(`${this.name}: createCharge not implemented`);
  }

  /** Capture/confirm a previously created charge. */
  // eslint-disable-next-line no-unused-vars
  async capture(providerRef) {
    return { status: 'succeeded', providerRef };
  }

  /** Refund a captured charge. */
  // eslint-disable-next-line no-unused-vars
  async refund({ providerRef, amount, currency }) {
    return { status: 'completed', providerRef };
  }

  /** Verify the current status of a charge (e.g. webhook reconciliation). */
  // eslint-disable-next-line no-unused-vars
  async verify(providerRef) {
    return { status: 'pending', providerRef };
  }
}

module.exports = IPaymentProvider;

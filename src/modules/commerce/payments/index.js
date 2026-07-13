const IPaymentProvider = require('./IPaymentProvider');

/**
 * ManualPaymentProvider — the DEFAULT, fully-functional provider used until a
 * live gateway is connected. A charge is created as `pending` and is settled by
 * a Super Admin marking it paid (offline/EFT/manual settlement). The complete
 * commerce loop (order → invoice → payment → wallet credit) works end-to-end.
 */
class ManualPaymentProvider extends IPaymentProvider {
  constructor() { super('manual'); }
  async createCharge({ invoice }) {
    return { status: 'pending', providerRef: `MANUAL-${invoice.invoiceNumber}`, requiresExternalAction: true };
  }
  async capture(providerRef) { return { status: 'succeeded', providerRef }; }
}

/**
 * Gateway adapters. These are STRUCTURALLY COMPLETE abstraction adapters: a
 * charge returns a `pending` intent with a provider reference and a flag that
 * external action is required. Live HTTP wiring to each gateway is a future
 * milestone (Part 7 explicitly defers gateway integration) and slots in here
 * without touching callers.
 */
class GatewayAdapter extends IPaymentProvider {
  async createCharge({ amount, currency, invoice }) {
    return {
      status: 'pending',
      providerRef: `${this.name.toUpperCase()}-${invoice.invoiceNumber}`,
      requiresExternalAction: true,
      // A real adapter would call the gateway API here and return a redirectUrl.
      redirectUrl: null,
      intent: { amount, currency },
    };
  }
}

class NuPayProvider extends GatewayAdapter { constructor() { super('nupay'); } }
class NetCashProvider extends GatewayAdapter { constructor() { super('netcash'); } }
class StripeProvider extends GatewayAdapter { constructor() { super('stripe'); } }
class PayFastProvider extends GatewayAdapter { constructor() { super('payfast'); } }
class OzowProvider extends GatewayAdapter { constructor() { super('ozow'); } }

const registry = {
  manual: new ManualPaymentProvider(),
  nupay: new NuPayProvider(),
  netcash: new NetCashProvider(),
  stripe: new StripeProvider(),
  payfast: new PayFastProvider(),
  ozow: new OzowProvider(),
};

function getProvider(name) {
  return registry[name] || registry.manual;
}

function listProviders() { return Object.keys(registry); }

module.exports = { getProvider, listProviders, IPaymentProvider };

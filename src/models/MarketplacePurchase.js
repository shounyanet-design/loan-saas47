const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * MarketplacePurchase — immutable record of a fulfilled purchase (purchase
 * history). Created when an order is paid + fulfilled. Tenant-scoped.
 */
const marketplacePurchaseSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder', required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceProduct' },
    sku: String,
    name: String,
    type: String,
    quantity: Number,
    amount: Number,
    currency: { type: String, default: 'ZAR' },
    tokensGranted: { type: Number, default: 0 },
    grants: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

marketplacePurchaseSchema.plugin(tenantPlugin);
marketplacePurchaseSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('MarketplacePurchase', marketplacePurchaseSchema);

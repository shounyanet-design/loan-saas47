const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/** Line item within an order. */
const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceProduct', required: true },
  sku: String,
  name: String,
  type: String,
  quantity: { type: Number, default: 1, min: 1 },
  unitPrice: { type: Number, required: true },
  lineTotal: { type: Number, required: true },
  grants: { type: mongoose.Schema.Types.Mixed, default: {} },
  bonusTokens: { type: Number, default: 0 },
}, { _id: false });

/**
 * MarketplaceOrder — a tenant's purchase order. Tenant-scoped.
 * Lifecycle: pending → (payment) → paid → fulfilled  |  cancelled.
 */
const marketplaceOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true },
    items: { type: [orderItemSchema], default: [] },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },
    couponCode: { type: String },
    status: { type: String, enum: ['pending', 'paid', 'fulfilled', 'cancelled', 'failed'], default: 'pending' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    fulfilledAt: { type: Date },
    placedBy: { type: String },
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

marketplaceOrderSchema.plugin(tenantPlugin);
marketplaceOrderSchema.index({ tenantId: 1, createdAt: -1 });
marketplaceOrderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });
marketplaceOrderSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('MarketplaceOrder', marketplaceOrderSchema);

const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * CommercePayment — a payment attempt against an Invoice via a payment provider.
 * Named distinctly from the existing LMS `Payment` (loan repayments) model to
 * avoid any collision. Tenant-scoped.
 *
 * `history` captures status transitions (covers the PaymentHistory
 * responsibility without a duplicate collection).
 */
const statusEventSchema = new mongoose.Schema({
  status: String,
  at: { type: Date, default: () => new Date() },
  note: String,
}, { _id: false });

const commercePaymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
    provider: { type: String, default: 'manual' }, // manual | netcash | stripe | payfast | ozow
    providerRef: { type: String, default: '' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'],
      default: 'pending',
    },
    history: { type: [statusEventSchema], default: [] },
    idempotencyKey: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

commercePaymentSchema.plugin(tenantPlugin);
commercePaymentSchema.index({ tenantId: 1, createdAt: -1 });
commercePaymentSchema.index({ tenantId: 1, status: 1 });
commercePaymentSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('CommercePayment', commercePaymentSchema);

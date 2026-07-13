const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/** Refund — a refund against a CommercePayment. Tenant-scoped. */
const refundSchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommercePayment', required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
    provider: { type: String, default: 'manual' },
    providerRef: { type: String, default: '' },
    issuedBy: { type: String },
    // If tokens were clawed back as part of the refund.
    tokensReversed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

refundSchema.plugin(tenantPlugin);
refundSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('Refund', refundSchema);

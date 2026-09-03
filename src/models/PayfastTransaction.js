const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * PayfastTransaction
 * ------------------
 * Isolated model storing Payfast payment attempts, raw ITN payloads,
 * server verification timestamps, and split payment details for
 * Marketplace and SaaS Subscription transactions.
 * Completely separate from LMS loan repayments.
 */
const payfastTransactionSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceOrder' },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantSubscription' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    userRef: { type: String },

    mPaymentId: { type: String, required: true, index: true }, // Internal merchant reference
    pfPaymentId: { type: String, index: true },                // Payfast pf_payment_id
    token: { type: String, index: true },                      // Payfast subscription token if recurring

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ZAR' },
    paymentType: { type: String, enum: ['marketplace', 'subscription'], required: true },

    status: {
      type: String,
      enum: ['pending', 'COMPLETE', 'FAILED', 'CANCELLED', 'succeeded', 'failed', 'cancelled'],
      default: 'pending',
    },

    splitDetails: {
      platformAmount: { type: Number },
      sellerAmount: { type: Number },
      platformFee: { type: Number },
      sellerId: { type: String },
      payfastSplitRef: { type: String },
    },

    signature: { type: String },
    rawItnData: { type: mongoose.Schema.Types.Mixed },
    verifiedAt: { type: Date },
    failureReason: { type: String },
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

payfastTransactionSchema.plugin(tenantPlugin);

payfastTransactionSchema.index({ tenantId: 1, createdAt: -1 });
payfastTransactionSchema.index({ tenantId: 1, mPaymentId: 1 });
payfastTransactionSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('PayfastTransaction', payfastTransactionSchema);

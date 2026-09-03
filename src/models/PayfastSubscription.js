const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * PayfastSubscription
 * -------------------
 * Stores recurring subscription token metadata provided by Payfast ITN callbacks.
 * Used strictly for SaaS subscription recurring status tracking.
 */
const payfastSubscriptionSchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    token: { type: String, required: true, index: true }, // Payfast subscription token / ID
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'ZAR' },
    status: {
      type: String,
      enum: ['active', 'paused', 'canceled', 'expired', 'failed'],
      default: 'active',
    },
    nextBillingDate: { type: Date },
    lastPaymentDate: { type: Date },
    payfastData: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

payfastSubscriptionSchema.plugin(tenantPlugin);
payfastSubscriptionSchema.index({ tenantId: 1, token: 1 }, { unique: true });

module.exports = mongoose.model('PayfastSubscription', payfastSubscriptionSchema);

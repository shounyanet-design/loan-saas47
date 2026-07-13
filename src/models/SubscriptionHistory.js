const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * SubscriptionHistory
 * -------------------
 * Append-only log of subscription lifecycle events. Tenant-scoped.
 */
const subscriptionHistorySchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    fromPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    event: {
      type: String,
      enum: ['create', 'upgrade', 'downgrade', 'renew', 'expire', 'cancel', 'resume', 'trial_start', 'trial_end'],
      required: true,
    },
    note: { type: String },
    actor: { type: String }, // platform user email or 'system'
    snapshot: { type: mongoose.Schema.Types.Mixed }, // subscription state at the time
  },
  { timestamps: true }
);

subscriptionHistorySchema.plugin(tenantPlugin);
subscriptionHistorySchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);

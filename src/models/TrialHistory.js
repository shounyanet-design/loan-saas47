const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * TrialHistory
 * ------------
 * Records trial periods granted to a tenant (used to prevent repeat trial abuse
 * and for reporting). Tenant-scoped.
 */
const trialHistorySchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    trialStart: { type: Date, required: true },
    trialEnd: { type: Date, required: true },
    converted: { type: Boolean, default: false }, // converted to a paid plan?
    outcome: { type: String, enum: ['active', 'expired', 'converted', 'canceled'], default: 'active' },
  },
  { timestamps: true }
);

trialHistorySchema.plugin(tenantPlugin);
trialHistorySchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('TrialHistory', trialHistorySchema);

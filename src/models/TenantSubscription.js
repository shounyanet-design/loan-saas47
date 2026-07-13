const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * TenantSubscription
 * ------------------
 * The active subscription for a tenant. Tenant-scoped (uses the tenant plugin),
 * so within a tenant request it auto-resolves to that tenant's subscription,
 * and platform (SYSTEM mode) sees all.
 */
const tenantSubscriptionSchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    subscriptionType: { type: String, enum: ['trial', 'monthly', 'yearly', 'custom'], default: 'trial' },

    trialStart: { type: Date },
    trialEnd: { type: Date },
    subscriptionStart: { type: Date },
    subscriptionEnd: { type: Date },
    renewalDate: { type: Date },
    nextInvoiceDate: { type: Date },

    status: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'expired', 'canceled', 'suspended'],
      default: 'trialing',
    },
    autoRenew: { type: Boolean, default: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly', 'none'], default: 'none' },
    cancelReason: { type: String },
  },
  { timestamps: true }
);

tenantSubscriptionSchema.plugin(tenantPlugin);
// One active subscription document per tenant. Named distinctly so it does not
// collide with the non-unique `tenantId_1` index added by the tenant plugin.
tenantSubscriptionSchema.index({ tenantId: 1 }, { unique: true, name: 'uniq_tenant_subscription' });

module.exports = mongoose.model('TenantSubscription', tenantSubscriptionSchema);

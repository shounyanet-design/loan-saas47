const mongoose = require('mongoose');

/**
 * SubscriptionPlan
 * ----------------
 * Platform-wide catalog of plans. PLATFORM-level (shared across tenants) —
 * NOT tenant-scoped, so it does NOT use the tenant plugin.
 *
 * Limit convention: -1 (or null) means UNLIMITED.
 */
const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },

    monthlyPrice: { type: Number, default: 0 },
    yearlyPrice: { type: Number, default: 0 },
    currency: { type: String, default: 'ZAR' },
    trialDays: { type: Number, default: 0 },

    // Limits (-1 = unlimited)
    maximumStaff: { type: Number, default: -1 },
    maximumBorrowers: { type: Number, default: -1 },
    maximumLoans: { type: Number, default: -1 },
    maximumBranches: { type: Number, default: -1 },
    maximumStorageGB: { type: Number, default: -1 },
    maximumApiCalls: { type: Number, default: -1 },
    maximumSms: { type: Number, default: -1 },
    maximumEmails: { type: Number, default: -1 },
    maximumOcr: { type: Number, default: -1 },
    maximumAml: { type: Number, default: -1 },
    maximumCreditReports: { type: Number, default: -1 },
    maximumFaceVerifications: { type: Number, default: -1 },
    maximumDocuments: { type: Number, default: -1 },

    enabledModules: { type: [String], default: [] },
    enabledIntegrations: { type: [String], default: [] },
    enabledFeatures: { type: [String], default: [] },

    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
    sortOrder: { type: Number, default: 0 },
    isPopular: { type: Boolean, default: false },
    // Internal grandfathering plan for existing tenants (not publicly listed).
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index({ status: 1, sortOrder: 1 });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);

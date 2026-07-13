const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * Wallet — one per tenant. Tenant-scoped (auto-isolated by the tenant plugin).
 *
 * Token accounting (all integers):
 *   availableTokens = purchasedTokens + bonusTokens - consumedTokens - reservedTokens
 * The balance is kept CACHED on the document and mutated only through guarded,
 * transactional operations in walletService (never recomputed per request).
 *
 * `currentBalance` is the monetary balance (currency) — credited on top-ups,
 * used for invoice settlement when paying from wallet funds.
 */
const walletSchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'ZAR' },
    status: { type: String, enum: ['active', 'frozen', 'closed'], default: 'active' },

    currentBalance: { type: Number, default: 0 },   // monetary (currency units)
    availableTokens: { type: Number, default: 0 },
    reservedTokens: { type: Number, default: 0 },
    consumedTokens: { type: Number, default: 0 },
    purchasedTokens: { type: Number, default: 0 },
    bonusTokens: { type: Number, default: 0 },

    lowBalanceThreshold: { type: Number, default: 100 },
    lowBalanceNotifiedAt: { type: Date },

    // Audit fields
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

walletSchema.plugin(tenantPlugin);
walletSchema.index({ tenantId: 1 }, { unique: true, name: 'uniq_tenant_wallet' });

module.exports = mongoose.model('Wallet', walletSchema);

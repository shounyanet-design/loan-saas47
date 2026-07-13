const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * WalletAdjustment — a manual super-admin credit/debit request against a wallet
 * (e.g. goodwill bonus, correction). Each approved adjustment produces an
 * immutable WalletTransaction. Tenant-scoped.
 */
const walletAdjustmentSchema = new mongoose.Schema(
  {
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    tokens: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    reason: { type: String, required: true },
    actor: { type: String, required: true }, // platform user email
    walletTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction' },
  },
  { timestamps: true }
);

walletAdjustmentSchema.plugin(tenantPlugin);
walletAdjustmentSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('WalletAdjustment', walletAdjustmentSchema);

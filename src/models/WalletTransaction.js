const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * WalletTransaction — IMMUTABLE append-only ledger entry. Tenant-scoped.
 *
 * This single collection fulfils both the "transaction" and "ledger"
 * responsibilities: every entry records the token delta plus the running
 * balanceBefore/balanceAfter, forming a complete audit ledger. Update/delete
 * are blocked at the schema level (WORM).
 *
 * Idempotency: `idempotencyKey` is uniquely indexed so a retried/replayed
 * operation can never be applied twice (replay / double-deduction protection).
 */
const walletTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['credit', 'debit', 'reserve', 'release', 'adjustment', 'purchase', 'consume', 'refund', 'bonus'],
      required: true,
    },
    // Token movement (positive number; `type` conveys direction).
    tokens: { type: Number, default: 0 },
    // Monetary movement (currency), when applicable.
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'ZAR' },

    balanceBefore: { type: Number, default: 0 },   // availableTokens before
    balanceAfter: { type: Number, default: 0 },    // availableTokens after

    reason: { type: String, default: '' },
    service: { type: String, default: '' },        // for consume entries
    refType: { type: String, default: '' },        // 'Order' | 'Invoice' | 'Adjustment' | 'UsageRecord'
    refId: { type: String, default: '' },
    actor: { type: String, default: 'system' },
    idempotencyKey: { type: String },
    status: { type: String, enum: ['committed', 'reversed'], default: 'committed' },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

walletTransactionSchema.plugin(tenantPlugin);
walletTransactionSchema.index({ tenantId: 1, createdAt: -1 });
walletTransactionSchema.index({ tenantId: 1, type: 1 });
// Idempotency / replay protection — unique per tenant when a key is present.
walletTransactionSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Append-only: block mutations.
const BLOCK = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
walletTransactionSchema.pre(BLOCK, function () {
  throw new Error('[WalletTransaction] is immutable (append-only) and cannot be modified or deleted.');
});

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

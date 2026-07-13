const mongoose = require('mongoose');

/**
 * IdempotencyRecord — durable "exactly-once" guard for outbound financial /
 * provider requests (e.g. NuPay/Webfin mandates & instalment actions).
 *
 * Deliberately NOT tenant-plugin scoped: it is written from singleton service
 * paths that may run outside an async tenant context. The `key` is globally
 * unique and already incorporates tenant/contract identifiers chosen by the
 * caller, and `tenantId` is stored as a plain field for auditing.
 *
 * Lifecycle: pending -> completed | failed. A stale `pending` record (older than
 * the caller's staleMs) is treated as a timed-out attempt and may be re-run
 * (timeout recovery). `completed` records store the provider response so a
 * replay of the same key+payload returns the original response (replay
 * protection / duplicate-response handling).
 */
const idempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    scope: { type: String, default: 'generic' },     // e.g. 'nupay'
    action: { type: String, default: '' },           // e.g. 'initiateMandate'
    requestHash: { type: String, required: true },    // sha256 of canonical request
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
    response: { type: mongoose.Schema.Types.Mixed },  // stored provider response (for replay)
    error: { type: String },
    attempts: { type: Number, default: 1 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// TTL — keep idempotency guarantees for 24h then auto-expire (configurable).
const TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS, 10) || 86400;
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);

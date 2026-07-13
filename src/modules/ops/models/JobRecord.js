const mongoose = require('mongoose');

/**
 * JobRecord — durable record of every queued job (PLATFORM-level). Powers
 * retry tracking and the Dead Letter Queue. The in-process queue adapter
 * persists state here so jobs survive inspection and the DLQ is queryable.
 */
const jobRecordSchema = new mongoose.Schema(
  {
    queue: { type: String, required: true, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ['queued', 'active', 'completed', 'failed', 'dead'], default: 'queued', index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: String, default: '' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    runAt: { type: Date, default: () => new Date() },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

jobRecordSchema.index({ queue: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model('JobRecord', jobRecordSchema);

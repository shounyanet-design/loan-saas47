const mongoose = require('mongoose');

/**
 * SystemLog — centralized structured log store (PLATFORM-level).
 * Backed by a CAPPED collection so it self-trims and never grows unbounded.
 */
const CATEGORIES = ['api', 'security', 'audit', 'queue', 'payment', 'integration', 'performance', 'error', 'auth', 'tenant_activity'];

const systemLogSchema = new mongoose.Schema(
  {
    category: { type: String, enum: CATEGORIES, default: 'api', index: true },
    level: { type: String, enum: ['debug', 'info', 'warn', 'error'], default: 'info', index: true },
    message: { type: String, required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    actor: { type: String },
    ip: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: () => new Date() },
  },
  {
    // 50 MB capped ring buffer.
    capped: { size: 50 * 1024 * 1024 },
    timestamps: false,
    versionKey: false,
  }
);

systemLogSchema.statics.CATEGORIES = CATEGORIES;
module.exports = mongoose.model('SystemLog', systemLogSchema);

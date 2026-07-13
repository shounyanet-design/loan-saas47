const mongoose = require('mongoose');

/**
 * PlatformAuditLog
 * ----------------
 * Append-only record of every Super Admin action. PLATFORM collection.
 * Update/delete are blocked at the schema level (WORM-style).
 */
const platformAuditLogSchema = new mongoose.Schema(
  {
    platformUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser' },
    platformUserEmail: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    action: { type: String, required: true }, // e.g. TENANT_SUSPENDED
    entity: { type: String }, // e.g. Tenant
    entityId: { type: String },
    oldValues: { type: mongoose.Schema.Types.Mixed },
    newValues: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

platformAuditLogSchema.index({ createdAt: -1 });
platformAuditLogSchema.index({ entity: 1, entityId: 1 });
platformAuditLogSchema.index({ platformUserId: 1, createdAt: -1 });

// Append-only: refuse mutations.
const BLOCK = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
platformAuditLogSchema.pre(BLOCK, function () {
  throw new Error('[PlatformAuditLog] is append-only and cannot be modified or deleted.');
});

module.exports = mongoose.model('PlatformAuditLog', platformAuditLogSchema);

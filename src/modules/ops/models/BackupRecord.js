const mongoose = require('mongoose');

/** BackupRecord — metadata for each backup run (PLATFORM-level). */
const backupRecordSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['logical', 'mongodump'], default: 'logical' },
    scope: { type: String, default: 'all' }, // 'all' or a collection name
    status: { type: String, enum: ['running', 'completed', 'failed', 'verified'], default: 'running' },
    location: { type: String, default: '' }, // directory / archive path
    collections: { type: [{ name: String, count: Number }], default: [] },
    documentCount: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date },
    verifiedAt: { type: Date },
    triggeredBy: { type: String, default: 'system' },
  },
  { timestamps: true }
);

backupRecordSchema.index({ createdAt: -1 });
module.exports = mongoose.model('BackupRecord', backupRecordSchema);

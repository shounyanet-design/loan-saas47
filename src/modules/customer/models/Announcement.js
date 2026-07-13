const mongoose = require('mongoose');

/**
 * Announcement — PLATFORM-global notices: product updates, maintenance windows,
 * release notes. Shown on the status page + customer portal. Not tenant-scoped.
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    type: { type: String, enum: ['info', 'maintenance', 'release', 'incident'], default: 'info' },
    severity: { type: String, enum: ['none', 'minor', 'major', 'critical'], default: 'none' },
    version: { type: String, default: '' }, // for release notes
    active: { type: Boolean, default: true },
    publishedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

announcementSchema.index({ active: 1, publishedAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);

const mongoose = require('mongoose');

/**
 * PlatformNotification
 * --------------------
 * Notifications shown in the Super Admin panel. PLATFORM collection.
 * A notification is either targeted (targetPlatformUserId set) or a broadcast
 * (isBroadcast = true, visible to all platform users).
 */
const platformNotificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['info', 'warning', 'error', 'success'], default: 'info' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    isBroadcast: { type: Boolean, default: false },
    targetPlatformUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser' },
    // Per-user read tracking (ids that have read this notification).
    readBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

platformNotificationSchema.index({ createdAt: -1 });
platformNotificationSchema.index({ targetPlatformUserId: 1 });

module.exports = mongoose.model('PlatformNotification', platformNotificationSchema);

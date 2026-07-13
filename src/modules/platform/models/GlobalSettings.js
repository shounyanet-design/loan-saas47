const mongoose = require('mongoose');

/**
 * GlobalSettings
 * --------------
 * Singleton document holding platform-wide configuration. PLATFORM collection
 * (not tenant scoped). Enforced single row via the unique `key`.
 */
const globalSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'GLOBAL', unique: true, immutable: true },
    platformName: { type: String, default: 'Point.47 Platform' },
    platformEmail: { type: String, default: '' },
    platformLogo: { type: String, default: '' },
    supportEmail: { type: String, default: '' },
    supportPhone: { type: String, default: '' },
    timezone: { type: String, default: 'Africa/Johannesburg' },
    currency: { type: String, default: 'ZAR' },
    language: { type: String, default: 'en' },
    maintenanceMode: { type: Boolean, default: false },
    registrationEnabled: { type: Boolean, default: true },
    defaultTrialDays: { type: Number, default: 14 },
    defaultStorageLimit: { type: Number, default: 1024 }, // MB
    defaultBorrowerLimit: { type: Number, default: 1000 },
    defaultUserLimit: { type: Number, default: 25 },
  },
  { timestamps: true }
);

/** Fetch the singleton settings document, creating defaults on first access. */
globalSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'GLOBAL' });
  if (!doc) doc = await this.create({ key: 'GLOBAL' });
  return doc;
};

module.exports = mongoose.model('GlobalSettings', globalSettingsSchema);

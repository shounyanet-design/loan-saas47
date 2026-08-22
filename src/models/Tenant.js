const mongoose = require('mongoose');

/**
 * Tenant
 * ------
 * The top-level organisation that owns an isolated set of LMS data.
 * This is a PLATFORM-level collection: it is NOT tenant-scoped and therefore
 * does NOT use the tenant plugin.
 */
const tenantSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, 'Tenant companyName is required'],
      trim: true,
    },
    // Stable, human-readable unique identifier (e.g. "POINT47").
    companyCode: {
      type: String,
      required: [true, 'Tenant companyCode is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      // Lowercase canonical values; the platform API accepts/echoes the
      // uppercase labels (ACTIVE/TRIAL/...) and maps them to these. The
      // original 'active'/'suspended'/'archived' values are preserved.
      enum: ['active', 'trial', 'pending', 'suspended', 'expired', 'disabled', 'archived'],
      default: 'active',
    },
    subscriptionStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'canceled', 'none'],
      default: 'active',
    },
    timezone: { type: String, default: 'Africa/Johannesburg' },
    currency: { type: String, default: 'ZAR' },
    locale: { type: String, default: 'en-ZA' },

    // ---- Platform-managed profile (added in Milestone 2.1, all optional) ----
    country: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '' },
    owner: { type: String, default: '' }, // owner/contact full name
    lastLoginAt: { type: Date },
    brandLogo: { type: String, default: '' },
    primaryColor: { type: String, default: '' },
    secondaryColor: { type: String, default: '' },
    maxUsers: { type: Number, default: 25 },
    maxBorrowers: { type: Number, default: 1000 },
    maxStorage: { type: Number, default: 1024 }, // MB

    // Marks the tenant that represents the original single-tenant deployment.
    isDefault: { type: Boolean, default: false },

    // Per-tenant feature flag overrides: { FEATURE_KEY: true|false }. Applied ON
    // TOP of the tenant's plan-derived features (override wins). Absent key =>
    // inherit from plan. Empty {} => pure plan behaviour (backward compatible).
    featureOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },

    companyProfile: {
      legalName: { type: String, default: '' },
      tradingName: { type: String, default: '' },
      cipcRegistrationNumber: { type: String, default: '' },
      ncrRegistrationNumber: { type: String, default: '' },
      vatNumber: { type: String, default: '' },
      telephone: { type: String, default: '' },
      email: { type: String, default: '' },
      registeredAddress: {
        addressLine1: { type: String, default: '' },
        addressLine2: { type: String, default: '' },
        city: { type: String, default: '' },
        province: { type: String, default: '' },
        postalCode: { type: String, default: '' },
        country: { type: String, default: '' }
      },
      authorizedSignatory: {
        fullName: { type: String, default: '' },
        designation: { type: String, default: '' }
      },
      logoUrl: { type: String, default: '' },
      website: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', tenantSchema);

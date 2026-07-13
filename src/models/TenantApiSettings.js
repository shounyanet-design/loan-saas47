const mongoose = require('mongoose');

/**
 * TenantApiSettings (production, Milestone 2.2)
 * --------------------------------------------
 * Per-tenant integration credentials. PLATFORM-level collection keyed by
 * tenantId (NOT tenant-plugin scoped).
 *
 * Each provider stores its credentials as a Map of ENCRYPTED strings
 * (AES-256-GCM via modules/saas/utils/crypto). The service layer encrypts on
 * write, masks on read, and decrypts only inside the credential resolver.
 *
 * BACKWARD COMPATIBILITY: integrations continue to read global .env by default.
 * The credential resolver returns tenant credentials only when a provider is
 * `enabled` with a `valid`/`untested` status; otherwise it falls back to .env.
 * The legacy `nupay` and `integrations` fields are retained.
 */

// Known providers (extensible — `providers` is an open Map).
const PROVIDERS = ['nupay', 'webfin', 'bulksms', 'emailjs', 'smtp', 'imagekit', 'facetec', 'datanamix'];

const providerSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    mode: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    // key -> encrypted value
    credentials: { type: Map, of: String, default: {} },
    status: { type: String, enum: ['unconfigured', 'untested', 'valid', 'invalid'], default: 'unconfigured' },
    lastTestedAt: { type: Date },
    lastTestResult: { type: String, default: '' },
    rotatedAt: { type: Date },
  },
  { _id: false }
);

const tenantApiSettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },

    // Structured, encrypted per-provider configuration.
    providers: { type: Map, of: providerSchema, default: {} },

    // ---- Legacy fields (retained for backward compatibility) ----
    nupay: {
      enabled: { type: Boolean, default: false },
      username: { type: String, select: false },
      password: { type: String, select: false },
      merchantId: { type: String },
      cardAcceptor: { type: String },
      apiEndpoint: { type: String },
    },
    integrations: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

tenantApiSettingsSchema.statics.PROVIDERS = PROVIDERS;

module.exports = mongoose.model('TenantApiSettings', tenantApiSettingsSchema);

const mongoose = require('mongoose');

/**
 * TenantSettings
 * --------------
 * Per-tenant locale / formatting preferences. One document per tenant.
 * PLATFORM-level collection keyed by tenantId — it is NOT tenant-plugin
 * scoped (it is read during tenant resolution, before a tenant context that
 * filters by tenantId would exist), so isolation is enforced by the unique
 * tenantId key plus explicit queries.
 */
const tenantSettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },
    timezone: { type: String, default: 'Africa/Johannesburg' },
    currency: { type: String, default: 'ZAR' },
    locale: { type: String, default: 'en-ZA' },
    defaultLanguage: { type: String, default: 'en' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    numberFormat: { type: String, default: '1,234.56' },

    // ---- Branding (Milestone 2.2, all optional/additive) ----
    branding: {
      logo: { type: String, default: '' },
      darkLogo: { type: String, default: '' },
      favicon: { type: String, default: '' },
      primaryColor: { type: String, default: '' },
      secondaryColor: { type: String, default: '' },
      accentColor: { type: String, default: '' },
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      fontFamily: { type: String, default: '' },
      footer: { type: String, default: '' },
      copyright: { type: String, default: '' },
      dashboardBranding: { type: String, default: '' },
      companyName: { type: String, default: '' },
      companyEmail: { type: String, default: '' },
      supportEmail: { type: String, default: '' },
      supportPhone: { type: String, default: '' },
      address: { type: String, default: '' },
      website: { type: String, default: '' },
      loginBackground: { type: String, default: '' },
      emailHeader: { type: String, default: '' },
      emailFooter: { type: String, default: '' },
      smsSignature: { type: String, default: '' },
      termsUrl: { type: String, default: '' },
      privacyUrl: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TenantSettings', tenantSettingsSchema);

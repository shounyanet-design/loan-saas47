const mongoose = require('mongoose');
const tenantPlugin = require('../../../tenancy/tenantPlugin');

/**
 * TenantApiKey — developer-portal API key for a tenant. Tenant-scoped.
 *
 * SECURITY: only a sha256 HASH of the key is stored; the raw key is shown ONCE
 * at creation. This is an ADDITIVE feature for a future public API surface and
 * is intentionally NOT wired into the existing authentication flow.
 */
const tenantApiKeySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    prefix: { type: String, required: true }, // non-secret visible identifier, e.g. pk_live_ab12
    keyHash: { type: String, required: true, select: false },
    scopes: { type: [String], default: ['read'] },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    lastUsedAt: { type: Date },
    createdByEmail: { type: String },
  },
  { timestamps: true }
);

tenantApiKeySchema.plugin(tenantPlugin);
tenantApiKeySchema.index({ tenantId: 1, createdAt: -1 });
tenantApiKeySchema.index({ prefix: 1 });

module.exports = mongoose.model('TenantApiKey', tenantApiKeySchema);

const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

/**
 * TenantDomain — a subdomain or custom domain mapped to a tenant. Tenant-scoped.
 * SSL provisioning itself is an ops/infra concern; this model TRACKS status.
 */
const tenantDomainSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, lowercase: true, trim: true },
    type: { type: String, enum: ['subdomain', 'custom'], default: 'custom' },
    isPrimary: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationMethods: { type: [{ type: String, enum: ['TXT', 'CNAME', 'A'] }], default: ['TXT', 'CNAME', 'A'] },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
    verificationAttempts: { type: Number, default: 0 },
    lastFailureReason: { type: String },
    
    dnsStatus: { type: String, enum: ['pending', 'configured', 'failed'], default: 'pending' },
    lastDnsCheck: { type: Date },
    dnsTtl: { type: Number },
    dnsDiagnostics: {
      resolver: String,
      lookupTimeMs: Number,
      propagationStatus: { type: String, enum: ['propagated', 'partial', 'pending'], default: 'pending' },
      lastSuccessfulLookup: Date,
    },
    
    sslStatus: { type: String, enum: ['none', 'pending', 'active', 'expired', 'failed'], default: 'none' },
    lastSslCheck: { type: Date },
    httpsEnabled: { type: Boolean, default: false },
    certificate: {
      issuer: String, expiresAt: Date, fingerprint: String, lastSync: Date
    },
    
    // Domain Availability (Case 3)
    availabilityStatus: { type: String, enum: ['available', 'unavailable', 'premium', 'invalid', 'reserved', 'unknown'] },
    lastAvailabilityCheck: { type: Date },
    suggestedDomainsCache: { type: [String], default: [] },
    registrar: { type: String },
    
    rootRedirect: { type: String, enum: ['force-www', 'force-non-www', 'none'], default: 'none' },
    redirectRules: { type: [{ from: String, to: String, code: { type: Number, default: 301 } }], default: [] },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

tenantDomainSchema.plugin(tenantPlugin);
tenantDomainSchema.index({ tenantId: 1, createdAt: -1 });
// A domain is globally unique across the platform.
tenantDomainSchema.index({ domain: 1 }, { unique: true });

module.exports = mongoose.model('TenantDomain', tenantDomainSchema);

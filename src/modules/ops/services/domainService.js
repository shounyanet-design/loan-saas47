const crypto = require('crypto');
const dns = require('dns').promises;
const dnsPromises = require('dns').promises;
const tenantContext = require('../../../tenancy/tenantContext');
const TenantDomain = require('../../../models/TenantDomain');
const logger = require('./loggingService');

const VERIFY_PREFIX = 'point47-verify=';

/** Add a domain to a tenant. Generates a DNS TXT verification token. */
async function addDomain(tenantId, { domain, type = 'custom', isPrimary = false }) {
  if (!domain) throw Object.assign(new Error('domain is required'), { status: 400 });
  const normalized = String(domain).toLowerCase().trim();
  return tenantContext.runAsSystem(async () => {
    if (await TenantDomain.findOne({ domain: normalized })) throw Object.assign(new Error('Domain already registered'), { status: 409 });
    const doc = await TenantDomain.create({
      tenantId, domain: normalized, type, isPrimary,
      verificationToken: crypto.randomBytes(16).toString('hex'),
    });
    logger.info('tenant_activity', `Domain added: ${normalized}`, { tenantId: String(tenantId) });
    return doc;
  });
}

/**
 * Verify domain ownership via a real DNS TXT lookup of the verification token.
 * In environments without outbound DNS the lookup simply fails and the domain
 * stays "pending" (no false positives). Super Admin can force-verify.
 */
async function verifyDomain(tenantId, domainId) {
  return tenantContext.runAsSystem(async () => {
    const doc = await TenantDomain.findOne({ _id: domainId, tenantId });
    if (!doc) throw Object.assign(new Error('Domain not found'), { status: 404 });
    
    doc.verificationAttempts += 1;
    let verified = false; 
    let detail = '';
    const expectedValue = `${VERIFY_PREFIX}${doc.verificationToken}`;
    
    const startTime = performance.now();
    
    // Attempt 1: TXT Record
    try {
      const records = await dnsPromises.resolveTxt(doc.domain);
      const flat = records.flat().join(' ');
      if (flat.includes(expectedValue)) {
        verified = true;
        detail = 'TXT record matched';
      }
    } catch (e) { detail = `TXT lookup failed: ${e.code || e.message}`; }

    // Attempt 2: CNAME Record
    if (!verified) {
      try {
        const cnameRecords = await dnsPromises.resolveCname(doc.domain);
        if (cnameRecords.some(r => r.includes('loan-saas47-production.up.railway.app'))) {
          verified = true;
          detail = 'CNAME record matched';
        }
      } catch (e) {}
    }

    // Attempt 3: A Record
    if (!verified) {
      try {
        const aRecords = await dnsPromises.resolve4(doc.domain);
        if (aRecords.includes('196.26.75.163')) {
          verified = true;
          detail = 'A record matched';
        }
      } catch (e) {}
    }

    // Record Diagnostics
    doc.dnsDiagnostics = {
      resolver: dnsPromises.getServers().join(', '),
      lookupTimeMs: Math.round(performance.now() - startTime),
      propagationStatus: verified ? 'propagated' : 'pending',
      lastSuccessfulLookup: verified ? new Date() : doc.dnsDiagnostics?.lastSuccessfulLookup
    };

    doc.verificationStatus = verified ? 'verified' : 'failed';
    doc.dnsStatus = verified ? 'configured' : 'pending';
    doc.lastDnsCheck = new Date();
    
    if (verified) { 
      doc.verifiedAt = new Date(); 
      doc.sslStatus = 'pending'; 
      doc.lastFailureReason = null;
    } else {
      doc.lastFailureReason = detail;
    }
    
    await doc.save();
    return { verified, detail, expectedTxt: expectedValue, diagnostics: doc.dnsDiagnostics };
  });
}

/** Super-admin manual override (e.g. verified out-of-band). */
async function forceVerify(domainId) {
  return tenantContext.runAsSystem(async () => {
    const doc = await TenantDomain.findById(domainId);
    if (!doc) throw Object.assign(new Error('Domain not found'), { status: 404 });
    doc.verificationStatus = 'verified'; doc.dnsStatus = 'configured'; doc.sslStatus = 'active';
    doc.verifiedAt = new Date(); doc.certificate = { issuer: 'manual', expiresAt: new Date(Date.now() + 365 * 86400000) };
    await doc.save();
    return doc;
  });
}

async function listForTenant(tenantId) {
  return tenantContext.runAsSystem(() => TenantDomain.find({ tenantId }).sort({ createdAt: -1 }).lean());
}

async function removeDomain(tenantId, domainId) {
  return tenantContext.runAsSystem(() => TenantDomain.deleteOne({ _id: domainId, tenantId }));
}

async function setPrimaryDomain(tenantId, domainId) {
  return tenantContext.runAsSystem(async () => {
    // Unset current primary
    await TenantDomain.updateMany({ tenantId }, { $set: { isPrimary: false } });
    // Set new primary
    const doc = await TenantDomain.findOneAndUpdate(
      { _id: domainId, tenantId, verificationStatus: 'verified' },
      { $set: { isPrimary: true } },
      { new: true }
    );
    if (!doc) throw Object.assign(new Error('Domain not found or not verified'), { status: 404 });
    return doc;
  });
}

async function refreshDns(tenantId, domainId) {
  // Triggers the verification engine directly
  return verifyDomain(tenantId, domainId);
}

async function updateDomainSettings(tenantId, domainId, settings) {
  return tenantContext.runAsSystem(async () => {
    const doc = await TenantDomain.findOne({ _id: domainId, tenantId });
    if (!doc) throw Object.assign(new Error('Domain not found'), { status: 404 });
    
    if (settings.rootRedirect) doc.rootRedirect = settings.rootRedirect;
    if (typeof settings.httpsEnabled === 'boolean') doc.httpsEnabled = settings.httpsEnabled;
    
    await doc.save();
    return doc;
  });
}

/** Resolve a Host header to a tenant (used by the optional domain resolver). */
async function resolveByHost(host) {
  if (!host) return null;
  const domain = String(host).toLowerCase().split(':')[0];
  return tenantContext.runAsSystem(() => TenantDomain.findOne({ domain, status: 'active', verificationStatus: 'verified' }).lean());
}

module.exports = { 
  addDomain, 
  verifyDomain, 
  forceVerify, 
  listForTenant, 
  removeDomain, 
  setPrimaryDomain,
  refreshDns,
  updateDomainSettings,
  resolveByHost, 
  VERIFY_PREFIX 
};

const crypto = require('crypto');
const dns = require('dns').promises;
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
    let verified = false; let detail = '';
    try {
      const records = await dns.resolveTxt(doc.domain);
      const flat = records.flat().join(' ');
      verified = flat.includes(`${VERIFY_PREFIX}${doc.verificationToken}`);
      detail = verified ? 'TXT record matched' : 'TXT record not found';
    } catch (e) { detail = `DNS lookup failed: ${e.code || e.message}`; }
    doc.verificationStatus = verified ? 'verified' : 'failed';
    doc.dnsStatus = verified ? 'configured' : 'pending';
    if (verified) { doc.verifiedAt = new Date(); doc.sslStatus = 'pending'; }
    await doc.save();
    return { verified, detail, expectedTxt: `${VERIFY_PREFIX}${doc.verificationToken}` };
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

/** Resolve a Host header to a tenant (used by the optional domain resolver). */
async function resolveByHost(host) {
  if (!host) return null;
  const domain = String(host).toLowerCase().split(':')[0];
  return tenantContext.runAsSystem(() => TenantDomain.findOne({ domain, status: 'active', verificationStatus: 'verified' }).lean());
}

module.exports = { addDomain, verifyDomain, forceVerify, listForTenant, removeDomain, resolveByHost, VERIFY_PREFIX };

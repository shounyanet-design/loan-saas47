const crypto = require('crypto');
const TenantApiKey = require('../models/TenantApiKey');

const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Generate a key. Returns the RAW key ONCE (never stored). Only the sha256 hash
 * is persisted. Tenant-context handler.
 */
async function generate({ name, scopes, email }) {
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const secret = crypto.randomBytes(24).toString('hex');
  const raw = `pk_${env}_${secret}`;
  const prefix = raw.slice(0, 12);
  const doc = await TenantApiKey.create({ name, scopes: scopes || ['read'], prefix, keyHash: hash(raw), createdByEmail: email });
  return { id: doc._id, name: doc.name, prefix, scopes: doc.scopes, apiKey: raw, note: 'Store this key now — it will not be shown again.' };
}

async function list() {
  return TenantApiKey.find({}).sort({ createdAt: -1 }).lean(); // keyHash is select:false
}

async function revoke(id) {
  const k = await TenantApiKey.findById(id);
  if (!k) throw Object.assign(new Error('API key not found'), { status: 404 });
  k.status = 'revoked';
  await k.save();
  return { id: k._id, status: k.status };
}

/** Verify a raw key (for a future public API). Returns the key doc or null. */
async function verify(rawKey) {
  if (!rawKey) return null;
  const tenantContext = require('../../../tenancy/tenantContext');
  return tenantContext.runAsSystem(async () => {
    const doc = await TenantApiKey.findOne({ keyHash: hash(rawKey), status: 'active' }).select('+keyHash');
    if (doc) { doc.lastUsedAt = new Date(); await doc.save(); }
    return doc;
  });
}

module.exports = { generate, list, revoke, verify };

const TenantApiSettings = require('../../../models/TenantApiSettings');
const tenantContext = require('../../../tenancy/tenantContext');
const { encrypt, decrypt, mask } = require('../utils/crypto');

/**
 * Tenant credential management + resolver.
 *
 * RESOLUTION ORDER (backward compatible):
 *   1. Tenant credentials  — only if the provider is `enabled` and has creds.
 *   2. Global .env         — fallback (current single-tenant behavior).
 *
 * Secrets are stored AES-256-GCM encrypted, never returned in cleartext to the
 * API (only masked), and decrypted solely inside `resolve()`.
 */

// Maps a provider's logical credential keys to global .env fallbacks.
const ENV_FALLBACK = {
  realpay: {
    clientId: 'REALPAY_CLIENT_ID',
    clientSecret: 'REALPAY_CLIENT_SECRET',
    merchantNumber: 'REALPAY_MERCHANT_NUMBER',
    baseUrl: 'REALPAY_BASE_URL',
    swaggerUsername: 'REALPAY_SWAGGER_USERNAME',
    swaggerPassword: 'REALPAY_SWAGGER_PASSWORD',
    product: 'REALPAY_PRODUCT',
    webhookUrl: 'REALPAY_WEBHOOK_URL',
    environment: 'REALPAY_ENVIRONMENT'
  },
  webfin: { username: 'WEBFIN_USERNAME', password: 'WEBFIN_PASSWORD', baseUrl: 'WEBFIN_BASE_URL', appName: 'WEBFIN_APP_NAME' },
  bulksms: { token: 'SMS_AUTH_TOKEN', tokenId: 'BULKSMS_TOKEN_ID', tokenSecret: 'BULKSMS_TOKEN_SECRET', baseUrl: 'BULKSMS_BASE_URL' },
  imagekit: { publicKey: 'IMAGEKIT_PUBLIC_KEY', privateKey: 'IMAGEKIT_PRIVATE_KEY', urlEndpoint: 'IMAGEKIT_URL_ENDPOINT' },
  datanamix: { clientId: 'DATANAMIX_CLIENT_ID', clientSecret: 'DATANAMIX_CLIENT_SECRET', baseUrl: 'DATANAMIX_BASE_URL' },
  emailjs: { serviceId: 'EMAILJS_SERVICE_ID', templateId: 'EMAILJS_TEMPLATE_ID', publicKey: 'EMAILJS_PUBLIC_KEY', privateKey: 'EMAILJS_PRIVATE_KEY' },
  smtp: { host: 'SMTP_HOST', port: 'SMTP_PORT', user: 'SMTP_USER', pass: 'SMTP_PASS' },
  facetec: { deviceKey: 'FACETEC_DEVICE_KEY', publicKey: 'FACETEC_PUBLIC_KEY', baseUrl: 'FACETEC_BASE_URL' },
};

const PROVIDER_REGISTRY = {
  realpay: {
    label: 'RealPay Debit Orders',
    description: 'RealPay OMNI Channel / DebiCheck TT1 & TT2 payment & mandate provider',
    testCapability: true,
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'Enter RealPay Client ID' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Enter RealPay Client Secret' },
      { key: 'merchantNumber', label: 'Merchant Number', type: 'text', placeholder: 'e.g. 23118' },
      { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://uat.realpaycollect.com:4448' },
      { key: 'swaggerUsername', label: 'Swagger Username', type: 'text', placeholder: 'chanainvint' },
      { key: 'swaggerPassword', label: 'Swagger Password', type: 'password', placeholder: 'Swagger Password' },
      { key: 'product', label: 'Product Code', type: 'text', placeholder: 'ABSADC' },
      { key: 'webhookUrl', label: 'Webhook URL', type: 'text', placeholder: 'https://loan-saas47-production.up.railway.app/api/v1/realpay/webhook' }
    ]
  },
  datanamix: {
    label: 'Datanamix IDV & KYC',
    description: 'Datanamix Identity Verification, Biometrics & Bureau Reports',
    testCapability: true,
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      { key: 'baseUrl', label: 'Base API Endpoint', type: 'text' }
    ]
  },
  webfin: {
    label: 'WebFin Core',
    description: 'WebFin Loan Management Service integration',
    testCapability: true,
    fields: [
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'baseUrl', label: 'Base URL', type: 'text' }
    ]
  },
  bulksms: {
    label: 'BulkSMS Service',
    description: 'SMS notifications for OTP and customer messages',
    testCapability: true,
    fields: [
      { key: 'tokenId', label: 'Token ID', type: 'text' },
      { key: 'tokenSecret', label: 'Token Secret', type: 'password' },
      { key: 'baseUrl', label: 'Base API Endpoint', type: 'text' }
    ]
  },
  emailjs: {
    label: 'EmailJS Notification',
    description: 'Transactional email notification provider',
    testCapability: true,
    fields: [
      { key: 'serviceId', label: 'Service ID', type: 'text' },
      { key: 'templateId', label: 'Template ID', type: 'text' },
      { key: 'publicKey', label: 'Public Key', type: 'text' },
      { key: 'privateKey', label: 'Private Key', type: 'password' }
    ]
  },
  smtp: {
    label: 'SMTP Email Gateway',
    description: 'Direct SMTP mail transfer agent',
    testCapability: true,
    fields: [
      { key: 'host', label: 'SMTP Host', type: 'text' },
      { key: 'port', label: 'SMTP Port', type: 'text' },
      { key: 'user', label: 'SMTP User', type: 'text' },
      { key: 'pass', label: 'SMTP Password', type: 'password' }
    ]
  },
  imagekit: {
    label: 'ImageKit Storage',
    description: 'Media CDN & Document asset storage',
    testCapability: true,
    fields: [
      { key: 'publicKey', label: 'Public Key', type: 'text' },
      { key: 'privateKey', label: 'Private Key', type: 'password' },
      { key: 'urlEndpoint', label: 'URL Endpoint', type: 'text' }
    ]
  },
  facetec: {
    label: 'FaceTec 3D Liveness',
    description: '3D Biometric Face Liveness check provider',
    testCapability: true,
    fields: [
      { key: 'deviceKey', label: 'Device Key Identifier', type: 'text' },
      { key: 'publicKey', label: 'Public Key', type: 'text' },
      { key: 'baseUrl', label: 'Server Base URL', type: 'text' }
    ]
  }
};

async function getSettings(tenantId) {
  return tenantContext.runAsSystem(async () => {
    let doc = await TenantApiSettings.findOne({ tenantId });
    if (!doc) doc = await TenantApiSettings.create({ tenantId });
    return doc;
  });
}

/** Save/replace credentials for a provider (encrypts each value). */
async function setProviderCredentials(tenantId, provider, { credentials = {}, enabled, mode } = {}) {
  return tenantContext.runAsSystem(async () => {
    const doc = await getSettings(tenantId);
    const existing = doc.providers.get(provider) || { credentials: new Map() };
    const encMap = new Map(existing.credentials || []);
    for (const [k, v] of Object.entries(credentials)) {
      if (v === '' || v === null) encMap.delete(k); // empty clears the key
      else encMap.set(k, encrypt(v));
    }
    doc.providers.set(provider, {
      enabled: enabled !== undefined ? !!enabled : (existing.enabled || false),
      mode: mode || existing.mode || 'production',
      credentials: encMap,
      status: 'untested',
      lastTestedAt: existing.lastTestedAt,
      lastTestResult: existing.lastTestResult || '',
      rotatedAt: new Date(),
    });
    await doc.save();
    return maskProvider(doc.providers.get(provider));
  });
}

/** Provider view with MASKED secrets (safe for API responses). */
function maskProvider(p) {
  if (!p) return null;
  const creds = {};
  const credMap = p.credentials instanceof Map ? p.credentials : new Map(Object.entries(p.credentials || {}));
  for (const [k, v] of credMap) creds[k] = mask(decryptSafe(v));
  return {
    enabled: p.enabled, mode: p.mode, status: p.status,
    lastTestedAt: p.lastTestedAt, lastTestResult: p.lastTestResult, rotatedAt: p.rotatedAt,
    credentials: creds,
  };
}

function decryptSafe(v) { try { return decrypt(v); } catch { return ''; } }

/** All providers with masked secrets. */
async function getMaskedSettings(tenantId) {
  const doc = await getSettings(tenantId);
  const providers = {};
  for (const name of TenantApiSettings.PROVIDERS) {
    providers[name] = maskProvider(doc.providers.get(name)) || { enabled: false, mode: 'production', status: 'unconfigured', credentials: {} };
  }
  return { tenantId, providers, registry: PROVIDER_REGISTRY };
}

/**
 * Resolve usable (decrypted) credentials for a provider, with .env fallback.
 * @returns {{ source: 'tenant'|'env', mode, credentials: object }}
 */
async function resolve(tenantId, provider) {
  const doc = await getSettings(tenantId);
  const p = doc.providers.get(provider);
  if (p && p.enabled && p.credentials && p.credentials.size > 0 && p.status !== 'invalid') {
    const creds = {};
    for (const [k, v] of p.credentials) creds[k] = decryptSafe(v);
    return { source: 'tenant', mode: p.mode, credentials: creds };
  }
  // Fallback to global .env.
  const map = ENV_FALLBACK[provider] || {};
  const creds = {};
  for (const [logical, envKey] of Object.entries(map)) {
    if (process.env[envKey] !== undefined) creds[logical] = process.env[envKey];
  }
  return { source: 'env', mode: 'production', credentials: creds };
}

/**
 * Test a provider's resolved credentials. Perform non-financial connectivity test.
 */
const REQUIRED_KEYS = {
  realpay: ['merchantNumber'],
  webfin: ['username', 'password', 'baseUrl'],
  bulksms: ['baseUrl'], imagekit: ['publicKey', 'privateKey', 'urlEndpoint'],
  datanamix: ['clientId', 'clientSecret', 'baseUrl'], emailjs: ['serviceId', 'publicKey'],
  smtp: ['host', 'port', 'user'], facetec: ['publicKey', 'baseUrl'],
};

async function testConnection(tenantId, provider) {
  if (provider === 'realpay') {
    try {
      const realpayService = require('../../../services/realpay/realpayService');
      const result = await realpayService.testConnection(tenantId);
      if (result.ok && result.source === 'tenant') {
        await tenantContext.runAsSystem(async () => {
          const doc = await getSettings(tenantId);
          const p = doc.providers.get(provider);
          if (p) { p.status = 'valid'; p.lastTestedAt = new Date(); p.lastTestResult = result.result; doc.providers.set(provider, p); await doc.save(); }
        });
      }
      return result;
    } catch (e) {
      return { provider, ok: false, source: 'unknown', mode: 'production', result: `Connection test failed: ${e.message}` };
    }
  }

  const resolved = await resolve(tenantId, provider);
  const required = REQUIRED_KEYS[provider] || [];
  const missing = required.filter((k) => !resolved.credentials[k]);
  const ok = missing.length === 0;
  const result = ok
    ? `OK (source: ${resolved.source}, mode: ${resolved.mode})`
    : `Missing required credential(s): ${missing.join(', ')}`;

  // Persist test outcome on the tenant provider (only when tenant-sourced).
  if (resolved.source === 'tenant') {
    await tenantContext.runAsSystem(async () => {
      const doc = await getSettings(tenantId);
      const p = doc.providers.get(provider);
      if (p) { p.status = ok ? 'valid' : 'invalid'; p.lastTestedAt = new Date(); p.lastTestResult = result; doc.providers.set(provider, p); await doc.save(); }
    });
  }
  return { provider, ok, source: resolved.source, mode: resolved.mode, result };
}

module.exports = {
  getSettings, getMaskedSettings, setProviderCredentials, resolve, testConnection, maskProvider, ENV_FALLBACK, PROVIDER_REGISTRY
};

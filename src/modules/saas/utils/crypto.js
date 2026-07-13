const crypto = require('crypto');

/**
 * Credential encryption — AES-256-GCM (authenticated encryption).
 *
 * Key source: CREDENTIAL_ENCRYPTION_KEY (64 hex chars / 32 bytes). For local
 * dev without that env set, a key is derived from JWT_SECRET so the system
 * still works — a one-time warning is printed. In production CREDENTIAL_
 * ENCRYPTION_KEY MUST be set to a dedicated random 32-byte key.
 *
 * Stored format: "v1:<iv b64>:<authTag b64>:<ciphertext b64>".
 */

let warned = false;
function getKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw && Buffer.from(raw, 'base64').length === 32) return Buffer.from(raw, 'base64');
  // Derived fallback (dev only).
  if (!warned) {
    console.warn('[crypto] CREDENTIAL_ENCRYPTION_KEY not set or invalid — deriving a key from JWT_SECRET (DEV ONLY). Set a dedicated 32-byte key in production.');
    warned = true;
  }
  return crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'point47-dev-secret')).digest();
}

function encrypt(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // Not an encrypted value (legacy plaintext) — return as-is for resilience.
    return String(payload);
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

function isEncrypted(payload) {
  return typeof payload === 'string' && payload.startsWith('v1:') && payload.split(':').length === 4;
}

/** Mask a secret for display: keep last `keep` chars, rest as dots. */
function mask(secret, keep = 4) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= keep) return '•'.repeat(s.length);
  return '•'.repeat(Math.max(4, s.length - keep)) + s.slice(-keep);
}

module.exports = { encrypt, decrypt, isEncrypted, mask };

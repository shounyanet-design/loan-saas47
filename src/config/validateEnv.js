/**
 * Environment validation (Part 10). Fails fast in production when critical
 * config is missing; warns in development. Call once at boot.
 */
const CRITICAL = ['MONGO_URI', 'JWT_SECRET'];
const RECOMMENDED = ['CREDENTIAL_ENCRYPTION_KEY', 'NODE_ENV', 'PORT'];

function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const missingCritical = CRITICAL.filter((k) => !process.env[k]);
  const missingRecommended = RECOMMENDED.filter((k) => !process.env[k]);

  if (missingCritical.length) {
    const msg = `[ENV] Missing critical variables: ${missingCritical.join(', ')}`;
    if (isProd) throw new Error(msg);
    console.warn(msg + ' (continuing in development)');
  }
  if (isProd && !process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.warn('[ENV] CREDENTIAL_ENCRYPTION_KEY not set in production — credentials will use a derived key. Set a dedicated 32-byte key.');
  }

  // Reject the known weak/default JWT secret and flag short secrets in production.
  const jwt = process.env.JWT_SECRET || '';
  if (jwt === 'point47_super_secret_key' || jwt === 'point47-dev-secret') {
    const msg = '[ENV] JWT_SECRET is set to a known default value — replace it with a strong random secret.';
    if (isProd) throw new Error(msg);
    console.warn(msg);
  } else if (isProd && jwt && jwt.length < 32) {
    console.warn('[ENV] JWT_SECRET is shorter than 32 characters — use a longer random secret in production.');
  }
  if (missingRecommended.length) console.warn(`[ENV] Recommended variables not set: ${missingRecommended.join(', ')}`);

  return { ok: missingCritical.length === 0, missingCritical, missingRecommended };
}

module.exports = validateEnv;

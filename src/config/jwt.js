// In production JWT_SECRET is mandatory (validateEnv throws if missing). The
// weak literal fallback is retained ONLY for local/dev convenience so the app
// can boot without a configured secret; it is never used when NODE_ENV=production.
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('[CONFIG] JWT_SECRET must be set in production');
}

module.exports = {
  secret: process.env.JWT_SECRET || 'point47_super_secret_key',
  expiresIn: '30d',
  algorithms: ['HS256'],
};

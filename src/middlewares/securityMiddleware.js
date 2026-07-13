const crypto = require('crypto');
const { sendError } = require('../utils/responseHandler');

/**
 * Security hardening (Part 9). All EXPORTED as opt-in middleware/helpers so the
 * existing app (which already uses helmet + cors + rate-limit) is not altered;
 * these are mounted on the new sensitive surfaces (webhooks, onboarding, etc.).
 */

/** Verify an HMAC-SHA256 webhook signature (timing-safe). */
function verifyWebhookSignature(secretEnvKey = 'WEBHOOK_SECRET', headerName = 'x-signature') {
  return (req, res, next) => {
    const secret = process.env[secretEnvKey];
    if (!secret) return sendError(res, 'Webhook secret not configured', 503);
    const provided = req.headers[headerName];
    if (!provided) return sendError(res, 'Missing signature', 401);
    const body = req.rawBody || JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(provided); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendError(res, 'Invalid signature', 401);
    next();
  };
}

/** In-memory brute-force guard (per key, e.g. IP+email). For multi-instance use Redis. */
const attempts = new Map();
function bruteForceGuard({ windowMs = 15 * 60 * 1000, max = 10, keyFn } = {}) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : (req.ip || 'unknown')) + ':' + req.path;
    const now = Date.now();
    const rec = attempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
    rec.count += 1; attempts.set(key, rec);
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ success: false, code: 'TOO_MANY_ATTEMPTS', message: `Too many attempts. Try again in ${retry}s.` });
    }
    next();
  };
}
/** Clear the counter on success (call from the controller on a good login). */
function clearBruteForce(req) { const base = (req.ip || 'unknown') + ':' + req.path; attempts.delete(base); }

/** Validate a platform API key (for machine-to-machine endpoints). */
function requireApiKey(envKey = 'PLATFORM_API_KEY', headerName = 'x-api-key') {
  return (req, res, next) => {
    const expected = process.env[envKey];
    if (!expected) return sendError(res, 'API key not configured', 503);
    const provided = req.headers[headerName] || '';
    const a = Buffer.from(provided); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendError(res, 'Invalid API key', 401);
    next();
  };
}

/** Extra security response headers (complements helmet). */
function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

/** Build a strict CSP directive string (for helmet.contentSecurityPolicy). */
function strictCsp() {
  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  };
}

/** Validate an IP against a tenant/platform allow-list (array of CIDRs/IPs). */
function ipAllowList(getList) {
  return (req, res, next) => {
    const list = (typeof getList === 'function' ? getList(req) : getList) || [];
    if (!list.length) return next(); // empty = allow all
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    if (list.includes(ip)) return next();
    return sendError(res, 'IP not allowed', 403);
  };
}

module.exports = { verifyWebhookSignature, bruteForceGuard, clearBruteForce, requireApiKey, securityHeaders, strictCsp, ipAllowList };

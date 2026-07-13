const crypto = require('crypto');

/**
 * Idempotency service — guarantees outbound financial/provider requests execute
 * exactly once even under provider timeouts, double-clicks, and retries.
 *
 * The decision logic (`decide`) and request hashing (`canonicalize`/`hashRequest`)
 * are pure and unit-testable without a database. `runOnce` is the Mongo-backed
 * orchestrator used at the call sites.
 */

/** Stable JSON: object keys sorted recursively so logically-equal payloads hash equally. */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** sha256 of the canonical request — the "request hash" / replay fingerprint. */
function hashRequest(request) {
  return crypto.createHash('sha256').update(canonicalize(request)).digest('hex');
}

/** Build a deterministic idempotency key from ordered parts. */
function buildKey(...parts) {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');
}

const DEFAULT_STALE_MS = parseInt(process.env.IDEMPOTENCY_STALE_MS, 10) || 2 * 60 * 1000; // 2 min

/**
 * Pure decision function. Given the existing record (or null), the incoming
 * request hash, and timing, decide what to do. Returns one of:
 *   { type: 'run' }                      -> execute the operation now
 *   { type: 'replay', response }         -> return the stored response (already done)
 *   { type: 'in_progress', retryAfterMs} -> a fresh attempt is mid-flight (reject as duplicate)
 *   { type: 'conflict' }                 -> same key reused with a DIFFERENT payload
 */
function decide(existing, requestHash, now = Date.now(), staleMs = DEFAULT_STALE_MS) {
  if (!existing) return { type: 'run' };

  if (existing.status === 'completed') {
    if (existing.requestHash === requestHash) return { type: 'replay', response: existing.response };
    return { type: 'conflict' };
  }

  if (existing.status === 'pending') {
    const startedAt = new Date(existing.updatedAt || existing.createdAt).getTime();
    const age = now - startedAt;
    if (age < staleMs) return { type: 'in_progress', retryAfterMs: staleMs - age };
    // Stale pending = previous attempt timed out / crashed -> safe to re-run.
    return { type: 'run' };
  }

  // failed -> safe retry
  return { type: 'run' };
}

class IdempotencyConflictError extends Error {
  constructor(message) { super(message); this.name = 'IdempotencyConflictError'; this.statusCode = 422; this.code = 'IDEMPOTENCY_CONFLICT'; }
}
class IdempotencyInProgressError extends Error {
  constructor(message, retryAfterMs) { super(message); this.name = 'IdempotencyInProgressError'; this.statusCode = 409; this.code = 'IDEMPOTENCY_IN_PROGRESS'; this.retryAfterMs = retryAfterMs; }
}

/**
 * Execute `executor` at most once for a given idempotency key.
 *
 * @param {object}   opts
 * @param {string}   opts.key      deterministic idempotency key (required)
 * @param {object}   opts.request  the request payload (hashed for replay protection)
 * @param {string}   [opts.scope]  grouping label, e.g. 'nupay'
 * @param {string}   [opts.action] action label, e.g. 'initiateMandate'
 * @param {ObjectId} [opts.tenantId]
 * @param {number}   [opts.staleMs]
 * @param {Function} executor      async () => providerResponse
 * @returns {Promise<{ replayed: boolean, response: any }>}
 */
async function runOnce(opts, executor) {
  const { key, request, scope = 'generic', action = '', tenantId, staleMs = DEFAULT_STALE_MS } = opts;
  if (!key) throw new Error('idempotencyService.runOnce: key is required');
  const IdempotencyRecord = require('../models/IdempotencyRecord');
  const requestHash = hashRequest(request);

  const existing = await IdempotencyRecord.findOne({ key }).lean();
  const decision = decide(existing, requestHash, Date.now(), staleMs);

  if (decision.type === 'replay') return { replayed: true, response: decision.response };
  if (decision.type === 'conflict') throw new IdempotencyConflictError(`Idempotency key "${key}" reused with a different payload`);
  if (decision.type === 'in_progress') throw new IdempotencyInProgressError(`Request "${key}" is already in progress`, decision.retryAfterMs);

  // Claim the slot. If no record yet, atomically insert a pending one; a unique
  // key collision means a concurrent request beat us -> treat as in-progress.
  if (!existing) {
    try {
      await IdempotencyRecord.create({ key, scope, action, requestHash, status: 'pending', tenantId, attempts: 1 });
    } catch (e) {
      if (e && e.code === 11000) throw new IdempotencyInProgressError(`Request "${key}" is already in progress`, staleMs);
      throw e;
    }
  } else {
    // Re-running a stale-pending or failed record.
    await IdempotencyRecord.updateOne(
      { key },
      { $set: { status: 'pending', requestHash, error: null }, $inc: { attempts: 1 } }
    );
  }

  try {
    const response = await executor();
    await IdempotencyRecord.updateOne({ key }, { $set: { status: 'completed', response, completedAt: new Date(), error: null } });
    return { replayed: false, response };
  } catch (err) {
    await IdempotencyRecord.updateOne({ key }, { $set: { status: 'failed', error: err && err.message ? err.message : String(err) } }).catch(() => {});
    throw err;
  }
}

module.exports = {
  canonicalize,
  hashRequest,
  buildKey,
  decide,
  runOnce,
  IdempotencyConflictError,
  IdempotencyInProgressError,
};

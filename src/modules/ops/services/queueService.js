const JobRecord = require('../models/JobRecord');
const tenantContext = require('../../../tenancy/tenantContext');

/**
 * Queue system (Part 4) with a pluggable adapter.
 *
 *  - DEFAULT: in-process adapter — works with NO external infra (no Redis).
 *    Every job is persisted as a JobRecord (durable, inspectable), retried up
 *    to maxAttempts, and moved to the Dead Letter Queue (status 'dead') on
 *    exhaustion.
 *  - OPTIONAL: if REDIS_URL is set AND `bullmq` is installed, a BullMQ adapter
 *    is used instead. It degrades gracefully to in-process if unavailable.
 *
 * Handlers are registered with defineQueue(name, handler). Producers call
 * enqueue(name, jobName, payload). Backward-compatible: nothing here runs
 * unless a queue is defined and a job enqueued.
 */

const QUEUE_NAMES = [
  'email', 'sms', 'notifications', 'ocr', 'aml', 'credit_bureau', 'facetec',
  'invoice', 'billing', 'subscriptions', 'marketplace', 'wallet', 'reports', 'webhooks',
];

const handlers = new Map(); // queueName -> { fn, maxAttempts }

function defineQueue(name, fn, { maxAttempts = 3 } = {}) {
  handlers.set(name, { fn, maxAttempts });
}

function usingBullMQ() {
  if (!process.env.REDIS_URL) return false;
  try { require.resolve('bullmq'); return true; } catch { return false; }
}

/** Execute a single job with retry semantics. Returns the final JobRecord. */
async function runJob(recordId) {
  return tenantContext.runAsSystem(async () => {
    const record = await JobRecord.findById(recordId);
    if (!record || ['completed', 'dead'].includes(record.status)) return record;
    const handler = handlers.get(record.queue);
    if (!handler) {
      record.status = 'failed'; record.lastError = 'No handler registered'; await record.save();
      return record;
    }
    while (record.attempts < record.maxAttempts) {
      record.status = 'active'; record.attempts += 1; record.startedAt = new Date(); await record.save();
      try {
        const result = await handler.fn(record.payload, record);
        record.status = 'completed'; record.result = result; record.completedAt = new Date(); await record.save();
        return record;
      } catch (err) {
        record.lastError = err.message;
        if (record.attempts >= record.maxAttempts) {
          record.status = 'dead'; record.completedAt = new Date(); await record.save(); // → DLQ
          // Surface exhausted jobs to error monitoring (additive; never throws).
          try { require('../../../observability/errorMonitoring').captureError(err, { source: 'queue', queue: record.queue, job: record.name, jobId: String(record._id), attempts: record.attempts }); } catch (_) {}
          return record;
        }
        record.status = 'queued'; await record.save();
      }
    }
    return record;
  });
}

/**
 * Enqueue a job. In-process mode processes it asynchronously (or awaited when
 * opts.awaitResult is set — used by tests and synchronous flows).
 */
async function enqueue(queue, name, payload = {}, opts = {}) {
  const handler = handlers.get(queue);
  const maxAttempts = opts.maxAttempts || (handler ? handler.maxAttempts : 3);
  const record = await tenantContext.runAsSystem(() => JobRecord.create({
    queue, name, payload, maxAttempts, tenantId: opts.tenantId, status: 'queued',
  }));

  if (usingBullMQ()) {
    try { return await enqueueBull(queue, name, payload, record, opts); }
    catch (e) { /* fall through to in-process */ }
  }

  if (opts.awaitResult) return { jobId: record._id, record: await runJob(record._id) };
  // Fire-and-forget: never blocks the caller, never throws into the request path.
  setImmediate(() => { runJob(record._id).catch(() => {}); });
  return { jobId: record._id, record };
}

// --- Optional BullMQ adapter (only loaded if REDIS_URL + bullmq present) ---
let bullQueues = null;
async function enqueueBull(queue, name, payload, record) {
  const { Queue } = require('bullmq');
  bullQueues = bullQueues || {};
  if (!bullQueues[queue]) bullQueues[queue] = new Queue(queue, { connection: { url: process.env.REDIS_URL } });
  await bullQueues[queue].add(name, { ...payload, _jobRecordId: String(record._id) }, { attempts: record.maxAttempts });
  return { jobId: record._id, record, adapter: 'bullmq' };
}

// --- Inspection / DLQ ---
async function stats() {
  return tenantContext.runAsSystem(async () => {
    const rows = await JobRecord.aggregate([{ $group: { _id: { queue: '$queue', status: '$status' }, count: { $sum: 1 } } }]);
    const out = {};
    for (const q of QUEUE_NAMES) out[q] = { queued: 0, active: 0, completed: 0, failed: 0, dead: 0 };
    for (const r of rows) { out[r._id.queue] = out[r._id.queue] || {}; out[r._id.queue][r._id.status] = r.count; }
    return { adapter: usingBullMQ() ? 'bullmq' : 'in-process', queues: out };
  });
}
async function deadLetters({ limit = 50 } = {}) {
  return tenantContext.runAsSystem(() => JobRecord.find({ status: 'dead' }).sort({ createdAt: -1 }).limit(limit).lean());
}
async function retryDead(jobId) {
  return tenantContext.runAsSystem(async () => {
    const r = await JobRecord.findById(jobId);
    if (!r || r.status !== 'dead') return null;
    r.status = 'queued'; r.attempts = 0; r.lastError = ''; await r.save();
    return runJob(r._id);
  });
}

module.exports = { QUEUE_NAMES, defineQueue, enqueue, runJob, stats, deadLetters, retryDead, usingBullMQ, _handlers: handlers };

/**
 * Prometheus metrics (Phase 3.1) — additive, isolated on its own registry so it
 * cannot interfere with any existing behaviour.
 *
 * Exposes (via GET /metrics):
 *  - Default process metrics: CPU, memory (RSS/heap), event-loop lag, GC, handles.
 *  - http_request_duration_seconds (histogram) + http_requests_total (counter):
 *    request rate, latency, status codes.
 *  - mongo_up + mongo_ping_ms: MongoDB connectivity/latency.
 *  - queue_jobs (gauge by queue+status): queue depth / DLQ size.
 *  - scheduler_last_run_timestamp (gauge by job): scheduler liveness.
 *  - integration_configured (gauge by provider): third-party config presence.
 */
const client = require('prom-client');
const mongoose = require('mongoose');

const register = new client.Registry();
register.setDefaultLabels({ app: 'point47-lms-backend' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const schedulerLastRun = new client.Gauge({
  name: 'scheduler_last_run_timestamp',
  help: 'Unix timestamp (seconds) of the last run of each scheduled job',
  labelNames: ['job'],
  registers: [register],
});

// --- Dynamic gauges via async collect (evaluated at scrape time) ---
new client.Gauge({
  name: 'mongo_up',
  help: 'MongoDB connection state (1 = connected)',
  registers: [register],
  async collect() {
    this.set(mongoose.connection.readyState === 1 ? 1 : 0);
  },
});

new client.Gauge({
  name: 'mongo_ping_ms',
  help: 'MongoDB admin ping round-trip latency in milliseconds (-1 if down)',
  registers: [register],
  async collect() {
    if (mongoose.connection.readyState !== 1) { this.set(-1); return; }
    try {
      const start = process.hrtime.bigint();
      await mongoose.connection.db.admin().ping();
      this.set(Number(process.hrtime.bigint() - start) / 1e6);
    } catch (_) { this.set(-1); }
  },
});

new client.Gauge({
  name: 'integration_configured',
  help: 'Whether a third-party integration is configured (1/0)',
  labelNames: ['provider'],
  registers: [register],
  collect() {
    const map = {
      datanamix: !!process.env.DATANAMIX_CLIENT_ID,
      facetec: !!process.env.FACETEC_DEVICE_KEY_IDENTIFIER,
      webfin_nupay: !!process.env.WEBFIN_USERNAME,
      bulksms: !!(process.env.SMS_AUTH_TOKEN || process.env.BULKSMS_TOKEN_ID),
      emailjs: !!process.env.EMAILJS_SERVICE_ID,
      imagekit: !!process.env.IMAGEKIT_PUBLIC_KEY,
      redis: !!process.env.REDIS_URL,
    };
    for (const [provider, on] of Object.entries(map)) this.set({ provider }, on ? 1 : 0);
  },
});

new client.Gauge({
  name: 'queue_jobs',
  help: 'Number of jobs per queue and status',
  labelNames: ['queue', 'status'],
  registers: [register],
  async collect() {
    // Only attempt when Mongo is connected; never throw into a scrape.
    if (mongoose.connection.readyState !== 1) return;
    try {
      const queueService = require('../modules/ops/services/queueService');
      const { queues } = await queueService.stats();
      for (const [queue, statuses] of Object.entries(queues || {})) {
        for (const [status, count] of Object.entries(statuses || {})) {
          this.set({ queue, status }, Number(count) || 0);
        }
      }
    } catch (_) { /* ignore — metrics must not fail */ }
  },
});

/** Express middleware: records duration + count for every request. */
function httpMetricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // Use the matched route template (low cardinality) rather than the raw URL.
    const route = req.route ? (req.baseUrl || '') + req.route.path : (req.baseUrl || req.path || 'unknown');
    const labels = { method: req.method, route, status_code: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

/** Called by the scheduler to mark a successful job run. */
function recordSchedulerRun(job) {
  schedulerLastRun.set({ job }, Math.floor(Date.now() / 1000));
}

module.exports = { register, httpMetricsMiddleware, recordSchedulerRun };

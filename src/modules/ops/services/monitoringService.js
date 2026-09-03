const os = require('os');
const mongoose = require('mongoose');
const queueService = require('./queueService');

/**
 * Monitoring (Part 6) — REAL runtime metrics (no mocked values).
 * Integration "status" is derived from configuration presence (resolver source)
 * rather than live external probes, to avoid cost/rate-limits and never affect
 * production traffic. Each integration reports whether it is configured.
 */

function cpu() {
  const load = os.loadavg(); // [1,5,15] min
  const cores = os.cpus().length || 1;
  return { loadAvg1: Number(load[0].toFixed(2)), cores, loadPercent: Number(((load[0] / cores) * 100).toFixed(1)) };
}

function memory() {
  const total = os.totalmem(), free = os.freemem();
  const proc = process.memoryUsage();
  return {
    systemTotalMb: Math.round(total / 1048576),
    systemUsedMb: Math.round((total - free) / 1048576),
    systemUsedPercent: Number((((total - free) / total) * 100).toFixed(1)),
    processRssMb: Math.round(proc.rss / 1048576),
    processHeapUsedMb: Math.round(proc.heapUsed / 1048576),
  };
}

async function mongoStatus() {
  const state = mongoose.connection.readyState; // 1 = connected
  let ping = null;
  if (state === 1) {
    const start = Date.now();
    try { await mongoose.connection.db.admin().ping(); ping = Date.now() - start; } catch { ping = null; }
  }
  return { state: ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown', connected: state === 1, pingMs: ping, name: mongoose.connection.name };
}

function integrationConfigured() {
  const has = (...keys) => keys.every((k) => !!process.env[k]);
  return {
    datanamix: { configured: has('DATANAMIX_CLIENT_ID', 'DATANAMIX_CLIENT_SECRET') },
    bulksms: { configured: has('BULKSMS_BASE_URL') && (has('SMS_AUTH_TOKEN') || has('BULKSMS_TOKEN_ID')) },
    email: { configured: has('EMAILJS_SERVICE_ID') || has('SMTP_HOST') },
    realpay: { configured: has('REALPAY_CLIENT_ID', 'REALPAY_CLIENT_SECRET') || has('REALPAY_MERCHANT_NUMBER') },
    imagekit: { configured: has('IMAGEKIT_PUBLIC_KEY', 'IMAGEKIT_PRIVATE_KEY') },
    redis: { configured: has('REDIS_URL') },
  };
}

/** Full health snapshot. */
async function health() {
  const [mongo, queues] = await Promise.all([mongoStatus(), queueService.stats().catch(() => null)]);
  const mem = memory();
  const alerts = [];
  if (!mongo.connected) alerts.push({ level: 'critical', message: 'MongoDB not connected' });
  if (mem.systemUsedPercent > 90) alerts.push({ level: 'warning', message: `High memory usage ${mem.systemUsedPercent}%` });
  if (queues) {
    const dead = Object.values(queues.queues).reduce((a, q) => a + (q.dead || 0), 0);
    if (dead > 0) alerts.push({ level: 'warning', message: `${dead} job(s) in the Dead Letter Queue` });
  }
  return {
    status: mongo.connected ? (alerts.some((a) => a.level === 'critical') ? 'degraded' : 'healthy') : 'down',
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    cpu: cpu(),
    memory: mem,
    mongo,
    queues,
    integrations: integrationConfigured(),
    alerts,
    timestamp: new Date(),
  };
}

/** Lightweight liveness/readiness for load balancers + Docker healthchecks. */
async function liveness() { return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }; }
async function readiness() {
  const mongo = await mongoStatus();
  return { ready: mongo.connected, mongo: mongo.connected };
}

module.exports = { health, liveness, readiness, cpu, memory, mongoStatus, integrationConfigured };

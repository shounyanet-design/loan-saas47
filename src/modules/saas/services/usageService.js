const mongoose = require('mongoose');
const UsageRecord = require('../../../models/UsageRecord');
const tenantContext = require('../../../tenancy/tenantContext');

/** Start of the current billing period (calendar month, UTC). */
function periodStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Record a metered usage event. Safe to call from anywhere:
 *  - inside a tenant request context (auto-stamped), or
 *  - with an explicit tenantId (wrapped in SYSTEM mode here).
 * Never throws into the caller's critical path.
 *
 * @param {object} p { service, action, provider, units, cost, currency, status, metadata, tenantId }
 */
async function record(p = {}) {
  const doc = {
    service: p.service,
    action: p.action || '',
    provider: p.provider || '',
    units: p.units != null ? p.units : 1,
    cost: p.cost || 0,
    currency: p.currency || 'ZAR',
    status: p.status || 'success',
    metadata: p.metadata,
    occurredAt: p.occurredAt || new Date(),
  };
  try {
    if (p.tenantId) {
      // Explicit tenant: stamp and write in SYSTEM mode (plugin bypass).
      return await tenantContext.runAsSystem(() => UsageRecord.create({ ...doc, tenantId: p.tenantId }));
    }
    // Rely on ambient tenant context (plugin auto-stamps tenantId).
    return await UsageRecord.create(doc);
  } catch (err) {
    console.error('[usage] failed to record', p.service, err.message);
    return null;
  }
}

/** Count of a service's usage in the current period. */
async function countInPeriod(service, opts = {}) {
  const match = { service, occurredAt: { $gte: periodStart() } };
  if (opts.tenantId) match.tenantId = new mongoose.Types.ObjectId(opts.tenantId);
  const run = async () => {
    const rows = await UsageRecord.aggregate([{ $match: match }, { $group: { _id: null, units: { $sum: '$units' } } }]);
    return rows.length ? rows[0].units : 0;
  };
  return opts.tenantId ? tenantContext.runAsSystem(run) : run();
}

/** Storage used (MB) in the current period — from `storage` usage units. */
async function getStorageUsedMb(opts = {}) {
  return countInPeriod('storage', opts);
}

/** Per-service usage summary for the current period. */
async function getSummary(opts = {}) {
  const match = { occurredAt: { $gte: periodStart() } };
  if (opts.tenantId) match.tenantId = new mongoose.Types.ObjectId(opts.tenantId);
  const run = async () => UsageRecord.aggregate([
    { $match: match },
    { $group: { _id: '$service', units: { $sum: '$units' }, cost: { $sum: '$cost' }, events: { $sum: 1 } } },
    { $project: { _id: 0, service: '$_id', units: 1, cost: 1, events: 1 } },
    { $sort: { units: -1 } },
  ]);
  const rows = opts.tenantId ? await tenantContext.runAsSystem(run) : await run();
  return rows;
}

module.exports = { record, countInPeriod, getStorageUsedMb, getSummary, periodStart };

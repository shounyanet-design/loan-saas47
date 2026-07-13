const cron = require('node-cron');
const tenantContext = require('../../../tenancy/tenantContext');
const logger = require('./loggingService');

/**
 * Scheduler (Part 5) — registers platform cron jobs. SEPARATE from the existing
 * LMS EMI cron (cronService.js) which is untouched. Each job is a pure async
 * function (independently testable) that the scheduler wraps in cron.
 *
 * initScheduler() is called from server.js at boot. Jobs run in SYSTEM mode.
 */
const Tenant = require('../../../models/Tenant');
const TenantSubscription = require('../../../models/TenantSubscription');
const Wallet = require('../../../models/Wallet');
const BackupRecord = require('../models/BackupRecord');

// ---- Job functions (exported for tests) ----
const jobs = {
  // Mark expired subscriptions.
  async subscriptionRenewal() {
    return tenantContext.runAsSystem(async () => {
      const now = new Date();
      const res = await TenantSubscription.updateMany(
        { status: { $in: ['active', 'trialing'] }, subscriptionEnd: { $lt: now }, autoRenew: false },
        { $set: { status: 'expired' } }
      );
      return { expired: res.modifiedCount };
    });
  },
  // Flag trials that have ended.
  async trialExpiry() {
    return tenantContext.runAsSystem(async () => {
      const now = new Date();
      const res = await TenantSubscription.updateMany(
        { status: 'trialing', trialEnd: { $lt: now } },
        { $set: { status: 'expired' } }
      );
      return { trialsExpired: res.modifiedCount };
    });
  },
  // Detect low wallet balances → enqueue notifications.
  async lowWalletBalance() {
    return tenantContext.runAsSystem(async () => {
      const queue = require('./queueService');
      const wallets = await Wallet.find({ status: 'active', $expr: { $lte: ['$availableTokens', '$lowBalanceThreshold'] } }).lean();
      for (const w of wallets) {
        // eslint-disable-next-line no-await-in-loop
        await queue.enqueue('notifications', 'low-balance', { tenantId: w.tenantId, event: 'LOW_BALANCE', title: 'Low token balance', message: `Balance ${w.availableTokens}` });
      }
      return { flagged: wallets.length };
    });
  },
  // Daily logical backup.
  async dailyBackup() {
    const backupService = require('./backupService');
    const rec = await backupService.createLogicalBackup({ triggeredBy: 'scheduler' });
    return { backupId: rec._id, docs: rec.documentCount };
  },
  // Cleanup: remove backups older than retention (default 30 days), keep records.
  async storageCleanup() {
    return tenantContext.runAsSystem(async () => {
      const cutoff = new Date(Date.now() - (Number(process.env.BACKUP_RETENTION_DAYS || 30)) * 86400000);
      const old = await BackupRecord.find({ createdAt: { $lt: cutoff } }).lean();
      const fs = require('fs');
      let removed = 0;
      for (const b of old) { try { if (b.location && fs.existsSync(b.location)) { fs.rmSync(b.location, { recursive: true, force: true }); removed++; } } catch (_) {} }
      return { cleaned: removed };
    });
  },
};

const SCHEDULES = [
  { name: 'subscriptionRenewal', cron: '0 1 * * *' },   // 01:00 daily
  { name: 'trialExpiry', cron: '0 1 * * *' },
  { name: 'lowWalletBalance', cron: '0 */6 * * *' },    // every 6h
  { name: 'dailyBackup', cron: '30 2 * * *' },          // 02:30 daily
  { name: 'storageCleanup', cron: '0 3 * * 0' },        // weekly
];

let started = false;
function initScheduler() {
  if (started) return; started = true;
  if (process.env.DISABLE_SCHEDULER === 'true') { logger.info('queue', 'Scheduler disabled via env'); return; }
  for (const s of SCHEDULES) {
    cron.schedule(s.cron, async () => {
      try {
        const r = await jobs[s.name]();
        try { require('../../../observability/metrics').recordSchedulerRun(s.name); } catch (_) {}
        logger.info('queue', `Scheduled job ${s.name} ran`, { result: r });
      }
      catch (e) {
        logger.error('error', `Scheduled job ${s.name} failed: ${e.message}`);
        try { require('../../../observability/errorMonitoring').captureError(e, { source: 'scheduler', job: s.name }); } catch (_) {}
      }
    });
  }
  logger.info('queue', `Scheduler initialized (${SCHEDULES.length} jobs)`);
}

module.exports = { initScheduler, jobs, SCHEDULES };

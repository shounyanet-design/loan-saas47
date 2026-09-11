const Tenant = require('../../models/Tenant');
const tenantContext = require('../../tenancy/tenantContext');
const collectionDispatcher = require('./collectionDispatcher');

class CollectionWorker {
  /**
   * Run daily collection dispatch across all active tenants.
   */
  async runDailyCollectionJob() {
    console.log('[CollectionWorker] Starting automated Loan Collection Engine worker job...');

    // Production safety feature flag check
    const isEngineEnabled = process.env.LOAN_COLLECTION_ENABLED === 'true' || process.env.NODE_ENV === 'test';
    if (!isEngineEnabled) {
      console.log('[CollectionWorker] Loan collection engine disabled by feature flag (LOAN_COLLECTION_ENABLED=false). Safe default.');
      return {
        enabled: false,
        reason: 'LOAN_COLLECTION_DISABLED_BY_FLAG',
        tenantsProcessed: 0,
        totalDispatched: 0,
        totalSkipped: 0,
        totalFailed: 0
      };
    }

    try {
      const activeTenants = await tenantContext.runAsSystem(() =>
        Tenant.find({ status: { $in: ['active', 'trialing'] } }).lean()
      );

      if (!activeTenants || activeTenants.length === 0) {
        const defaultTenant = await tenantContext.runAsSystem(() => Tenant.findOne({ isDefault: true }).lean());
        if (defaultTenant) activeTenants.push(defaultTenant);
      }

      const summary = {
        tenantsProcessed: activeTenants.length,
        totalDispatched: 0,
        totalSkipped: 0,
        totalFailed: 0
      };

      for (const tenant of activeTenants) {
        try {
          await tenantContext.runWithTenant(tenant._id, async () => {
            const results = await collectionDispatcher.dispatchDueCollectionsForTenant(tenant._id);
            for (const r of results) {
              if (r.status === 'DISPATCHED') summary.totalDispatched++;
              else if (r.status === 'SKIPPED') summary.totalSkipped++;
              else summary.totalFailed++;
            }
          });
        } catch (tenantErr) {
          console.error(`[CollectionWorker] Error processing tenant ${tenant._id}:`, tenantErr.message);
        }
      }

      console.log('[CollectionWorker] Finished collection worker job:', summary);
      return summary;
    } catch (err) {
      console.error('[CollectionWorker] Failed to execute daily collection worker job:', err.message);
      throw err;
    }
  }
}

module.exports = new CollectionWorker();

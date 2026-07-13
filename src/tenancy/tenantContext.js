/**
 * Tenant Context (AsyncLocalStorage)
 * ----------------------------------
 * Holds the "current tenant" for the lifetime of an async operation (an HTTP
 * request, a cron tick, a migration run, etc.) without having to thread a
 * tenantId argument through every function call.
 *
 * Two modes of execution:
 *   - TENANT mode  -> runWithTenant(tenantId, fn): all tenant-scoped queries
 *                     are automatically filtered/stamped with this tenantId.
 *   - SYSTEM mode  -> runAsSystem(fn): tenant filtering is bypassed. Used ONLY
 *                     for trusted, cross-tenant operations: auth bootstrap
 *                     (resolving who a user is), migrations, seeders and
 *                     platform-level background jobs.
 *
 * FAIL-CLOSED CONTRACT (enforced by tenantPlugin.js):
 *   If a tenant-scoped query runs with NO context at all (neither TENANT nor
 *   SYSTEM mode), the plugin throws instead of returning data. A missing
 *   context can never silently leak another tenant's data.
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with an active tenant. Returns whatever `fn` returns (supports async).
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {Function} fn
 */
function runWithTenant(tenantId, fn) {
  if (!tenantId) {
    throw new Error('[tenantContext] runWithTenant called without a tenantId');
  }
  // Await the callback INSIDE the context so that a returned (but not-yet-
  // executed) Mongoose query runs while the context is still active. Without
  // this, `runWithTenant(id, () => Model.find())` would execute the query
  // after the context popped and trip the fail-closed guard.
  return storage.run({ tenantId: String(tenantId), system: false }, async () => fn());
}

/**
 * Run `fn` in SYSTEM (bypass) mode — no tenant filtering. Use sparingly and
 * only for trusted cross-tenant operations.
 * @param {Function} fn
 */
function runAsSystem(fn) {
  // See runWithTenant: await inside the context so returned queries execute
  // before the context pops.
  return storage.run({ tenantId: null, system: true }, async () => fn());
}

/** Raw store accessor ({ tenantId, system } | undefined). */
function getStore() {
  return storage.getStore();
}

/** Current tenantId, or null when none / system mode. */
function getTenantId() {
  const store = storage.getStore();
  return store ? store.tenantId : null;
}

/** True when executing inside an explicit SYSTEM (bypass) context. */
function isSystem() {
  const store = storage.getStore();
  return !!(store && store.system);
}

/** True when ANY context (tenant or system) is active. */
function hasContext() {
  return storage.getStore() !== undefined;
}

module.exports = {
  runWithTenant,
  runAsSystem,
  getStore,
  getTenantId,
  isSystem,
  hasContext,
};

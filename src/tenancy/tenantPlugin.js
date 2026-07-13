/**
 * Mongoose Tenant Plugin
 * ----------------------
 * Apply to every TENANT-SCOPED business model:
 *
 *     const tenantPlugin = require('../tenancy/tenantPlugin');
 *     schema.plugin(tenantPlugin);
 *
 * Responsibilities (all automatic — controllers need no changes):
 *   1. Adds an indexed `tenantId` field to the schema.
 *   2. Auto-filters every read/update/delete query by the current tenantId.
 *   3. Auto-stamps `tenantId` on create / save / insertMany.
 *   4. Injects a `{ $match: { tenantId } }` stage at the head of aggregations.
 *
 * FAIL-CLOSED: if a query runs with no tenant context AND not in SYSTEM mode,
 * the plugin throws. It will never fall back to returning unscoped data.
 *
 * SYSTEM mode (tenantContext.runAsSystem) bypasses all of the above — used for
 * auth bootstrap, migrations, seeders and trusted cross-tenant jobs.
 */

const mongoose = require('mongoose');
const tenantContext = require('./tenantContext');

// Query middlewares that must be tenant-filtered. `findById`/`findByIdAnd*`
// are translated by Mongoose to the `findOne*` ops below, so they are covered.
const QUERY_HOOKS = [
  'count',
  'countDocuments',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndRemove',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'update',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
];

module.exports = function tenantPlugin(schema) {
  // 1. tenantId field (indexed). ref: 'Tenant' for populate support.
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
  });

  /**
   * Resolve the effective tenantId for the current execution, or signal bypass.
   * @returns {{ bypass: boolean, tenantId: string|null }}
   */
  function resolve(opLabel) {
    if (tenantContext.isSystem()) {
      return { bypass: true, tenantId: null };
    }
    const tenantId = tenantContext.getTenantId();
    if (tenantId) {
      return { bypass: false, tenantId };
    }
    // No tenant + not system => fail closed.
    throw new Error(
      `[tenantPlugin] Tenant context missing for "${opLabel}" on model "${
        schema.get('collection') || 'unknown'
      }". Wrap trusted cross-tenant access in tenantContext.runAsSystem().`
    );
  }

  // 2 + 3 (queries). Force the context tenantId onto the filter so a caller
  // can never widen scope to another tenant.
  schema.pre(QUERY_HOOKS, function tenantQueryGuard() {
    const { bypass, tenantId } = resolve(this.op || 'query');
    if (bypass) return;
    this.where({ tenantId });
  });

  // 3 (create / save).
  schema.pre('save', function tenantSaveGuard() {
    const { bypass, tenantId } = resolve('save');
    if (bypass) {
      // SYSTEM mode respects an explicitly-set tenantId. But a NEW tenant-scoped
      // document being created with NO tenantId (seeder/import/script) is the
      // root cause of "user has no tenant -> 403". Surface it loudly so it is
      // caught in dev/CI; `npm run doctor` / `npm run repair` can remediate.
      if (this.isNew && !this.tenantId) {
        console.warn(
          `[tenantPlugin] WARNING: creating ${this.constructor.modelName || 'document'} ` +
          `without a tenantId in SYSTEM mode. It will be invisible to tenant-scoped ` +
          `queries. Set tenantId explicitly or wrap creation in runWithTenant().`
        );
      }
      return; // system mode: respect whatever tenantId (if any) was set explicitly
    }
    if (!this.tenantId) {
      this.tenantId = tenantId;
    } else if (String(this.tenantId) !== String(tenantId)) {
      // Refuse to save a document into a different tenant than the active one.
      throw new Error('[tenantPlugin] Attempt to save document for a different tenant');
    }
  });

  // 3 (insertMany). Mongoose 9 uses a promise-style hook: `(docs)` is the
  // array, `this` is the Model. Throwing rejects insertMany (fail-closed).
  schema.pre('insertMany', function tenantInsertManyGuard(docs) {
    const { bypass, tenantId } = resolve('insertMany');
    if (bypass || !Array.isArray(docs)) return;
    docs.forEach((doc) => {
      if (!doc.tenantId) doc.tenantId = tenantId;
    });
  });

  // 4 (aggregate). NOTE: this scopes the ROOT collection only. A `$lookup`
  // stage reads its `from` collection WITHOUT this filter, so any future
  // aggregation that uses `$lookup` MUST add a tenantId match inside the lookup
  // pipeline. There is no `$lookup` usage in the codebase today.
  schema.pre('aggregate', function tenantAggregateGuard() {
    const { bypass, tenantId } = resolve('aggregate');
    if (bypass) return;
    this.pipeline().unshift({ $match: { tenantId: new mongoose.Types.ObjectId(tenantId) } });
  });

  // 5. Operations that CANNOT be safely auto-scoped in this Mongoose version.
  // They fail closed outside SYSTEM mode so they can never bypass isolation.
  // (Neither is used in the codebase today; the guards are defensive.)
  schema.pre('bulkWrite', function tenantBulkWriteGuard() {
    if (tenantContext.isSystem()) return;
    throw new Error(
      '[tenantPlugin] bulkWrite is not tenant-safe: its operations are not ' +
        'auto-scoped. Run inside tenantContext.runAsSystem() and set tenantId ' +
        'explicitly on every operation.'
    );
  });

  schema.pre('estimatedDocumentCount', function tenantEstimatedCountGuard() {
    if (tenantContext.isSystem()) return;
    throw new Error(
      '[tenantPlugin] estimatedDocumentCount ignores query filters and would ' +
        'count all tenants. Use countDocuments() instead (it is tenant-scoped).'
    );
  });
};

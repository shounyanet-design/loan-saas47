/**
 * Migration 002 — Backfill tenantId onto all existing business records.
 *
 * Assigns every pre-existing document in every tenant-scoped collection to the
 * default tenant created by migration 001.
 *
 * Idempotent: only documents that are MISSING a tenantId (absent or null) are
 * updated, so re-running is a no-op for already-migrated data.
 *
 * Uses the native driver (Model.collection.updateMany) to bypass the tenant
 * plugin middleware — the migration is a trusted, cross-tenant operation.
 */

const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const loadAllModels = require('./_loadModels');

// Platform-level collections that legitimately carry a tenantId field but must
// NOT be backfilled with the default tenant.
const SKIP_MODELS = new Set(['Tenant', 'TenantSettings', 'TenantApiSettings']);

async function up() {
  loadAllModels();

  const tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) {
    throw new Error('[002] Default tenant not found. Run migration 001 first.');
  }
  const tenantId = tenant._id;
  console.log(`  [002] Backfilling to default tenant ${tenantId}`);

  const summary = [];
  for (const name of Object.keys(mongoose.models)) {
    if (SKIP_MODELS.has(name)) continue;
    const Model = mongoose.models[name];
    // Only collections that are tenant-scoped (have a tenantId path).
    if (!Model.schema.path('tenantId')) continue;

    const res = await Model.collection.updateMany(
      { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
      { $set: { tenantId } }
    );
    summary.push({ model: name, modified: res.modifiedCount });
  }

  console.table(summary);
  const total = summary.reduce((a, s) => a + s.modified, 0);
  console.log(`  [002] Backfill complete. Documents updated this run: ${total}`);
  return { total, summary };
}

/**
 * Rollback: unset tenantId on documents belonging to the default tenant.
 * DESTRUCTIVE for multi-tenant data — only meaningful while a single default
 * tenant exists. Guarded behind MIGRATION_ALLOW_DOWN=true. DEV/recovery only.
 */
async function down() {
  if (process.env.MIGRATION_ALLOW_DOWN !== 'true') {
    throw new Error('[002 down] Refusing to run without MIGRATION_ALLOW_DOWN=true (destructive).');
  }
  loadAllModels();
  const tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) {
    console.log('  [002 down] No default tenant; nothing to do.');
    return;
  }
  let total = 0;
  for (const name of Object.keys(mongoose.models)) {
    if (SKIP_MODELS.has(name)) continue;
    const Model = mongoose.models[name];
    if (!Model.schema.path('tenantId')) continue;
    const res = await Model.collection.updateMany(
      { tenantId: tenant._id },
      { $unset: { tenantId: '' } }
    );
    total += res.modifiedCount;
  }
  console.log(`  [002 down] Unset tenantId on ${total} documents.`);
}

module.exports = { up, down };

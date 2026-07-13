/**
 * Tenant self-healing & integrity utilities.
 *
 * Purpose: permanently prevent the "valid login but every request 403s because
 * the user has no tenantId" regression. Provides:
 *   - pickHealableTenant(tenants)  — PURE decision logic (unit-testable)
 *   - findHealableTenant()         — DB-backed tenant resolution (SYSTEM mode)
 *   - healUserTenant(user)         — assign the unambiguous tenant to a user once
 *   - scanMissingTenantId()        — integrity scan across tenant-scoped models
 *
 * SECURITY: healing NEVER guesses. It only assigns a tenant when the choice is
 * unambiguous (a single default tenant, or exactly one tenant in the system).
 * When multiple tenants exist with no single default, it refuses and surfaces a
 * meaningful error — it never attaches a user to an arbitrary tenant.
 */
const mongoose = require('mongoose');
const tenantContext = require('./tenantContext');

const NO_TENANT_MESSAGE =
  'User account is not associated with any tenant. Please contact the system administrator.';

/**
 * PURE: decide which tenant (if any) a tenant-less user may be healed into.
 * @param {Array<{_id:any,isDefault?:boolean,status?:string}>} tenants
 * @returns {{ tenantId:any } | { error:string, code:string }}
 */
function pickHealableTenant(tenants) {
  const list = Array.isArray(tenants) ? tenants : [];
  if (list.length === 0) {
    return { error: 'No tenant exists in the system.', code: 'NO_TENANT' };
  }
  const defaults = list.filter((t) => t && t.isDefault);
  if (defaults.length === 1) return { tenantId: defaults[0]._id };
  if (defaults.length > 1) {
    return { error: 'Multiple default tenants found; cannot auto-resolve.', code: 'AMBIGUOUS_DEFAULT' };
  }
  // No default flagged. Safe only when there is exactly one tenant overall.
  if (list.length === 1) return { tenantId: list[0]._id };
  return { error: NO_TENANT_MESSAGE, code: 'AMBIGUOUS_TENANT' };
}

/** Load tenants (SYSTEM mode — Tenant is a platform collection) and pick one. */
async function findHealableTenant() {
  const Tenant = mongoose.models.Tenant || require('../models/Tenant');
  const tenants = await tenantContext.runAsSystem(() =>
    Tenant.find({}, { _id: 1, isDefault: 1, status: 1 }).lean()
  );
  return pickHealableTenant(tenants);
}

/**
 * Heal a single user document that is missing a tenantId. Idempotent: a user
 * that already has a tenantId is left untouched. Persists the change once and
 * mutates the in-memory `user` so the caller can continue the request.
 *
 * @param {import('mongoose').Document & { _id:any, tenantId?:any }} user
 * @returns {Promise<{healed:boolean, tenantId?:any, alreadyScoped?:boolean, reason?:string, code?:string}>}
 */
async function healUserTenant(user) {
  if (!user) return { healed: false, reason: 'No user provided', code: 'NO_USER' };
  if (user.tenantId) return { healed: false, alreadyScoped: true, tenantId: user.tenantId };

  const pick = await findHealableTenant();
  if (pick.error) return { healed: false, reason: pick.error, code: pick.code };

  const User = mongoose.models.User || require('../models/User');
  // Native update under SYSTEM mode — bypasses the tenant plugin guard and
  // avoids re-running validation/hooks. Only sets tenantId when still missing
  // (so a concurrent heal cannot double-assign).
  await tenantContext.runAsSystem(() =>
    User.collection.updateOne(
      { _id: user._id, $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
      { $set: { tenantId: pick.tenantId } }
    )
  );
  user.tenantId = pick.tenantId; // reflect in memory for the live request
  console.warn(`[tenant-heal] Assigned default tenant ${pick.tenantId} to user ${user._id} (${user.email || 'unknown'}).`);
  return { healed: true, tenantId: pick.tenantId };
}

/**
 * Count documents missing a tenantId across every tenant-scoped model.
 * Read-only. Runs in SYSTEM mode. Returns { models: [{name,missing,total}], totalMissing }.
 */
async function scanMissingTenantId() {
  return tenantContext.runAsSystem(async () => {
    const out = [];
    for (const name of Object.keys(mongoose.models)) {
      const Model = mongoose.models[name];
      if (!Model.schema || !Model.schema.path('tenantId')) continue;
      // Use the native collection to avoid the plugin (we are intentionally
      // counting across all tenants).
      const missing = await Model.collection.countDocuments({
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
      });
      const total = await Model.collection.estimatedDocumentCount();
      out.push({ name, missing, total });
    }
    const totalMissing = out.reduce((a, m) => a + m.missing, 0);
    return { models: out.sort((a, b) => b.missing - a.missing), totalMissing };
  });
}

/**
 * Startup validation — logs a WARNING (never throws/crashes) if tenant-scoped
 * data is missing tenantId or no default tenant exists. Safe to call after the
 * DB connection opens.
 */
async function logTenantIntegrityWarnings() {
  try {
    const Tenant = mongoose.models.Tenant || require('../models/Tenant');
    const [tenantCount, defaultCount, scan] = await tenantContext.runAsSystem(async () => Promise.all([
      Tenant.collection.countDocuments({}),
      Tenant.collection.countDocuments({ isDefault: true }),
      scanMissingTenantId(),
    ]));

    const problems = scan.models.filter((m) => m.missing > 0);
    if (tenantCount === 0 || defaultCount === 0 || problems.length) {
      console.warn('\n⚠️  ===== TENANT INTEGRITY WARNING =====');
      if (tenantCount === 0) console.warn('   • No tenants exist.');
      if (defaultCount === 0) console.warn('   • No DEFAULT tenant is set.');
      for (const m of problems) console.warn(`   • ${m.missing} ${m.name} record(s) missing tenantId`);
      console.warn('   These accounts/records will be rejected (403) or invisible to tenant queries.');
      console.warn('   Fix with:  npm run repair      (or)  npm run migrate');
      console.warn('   Diagnose:  npm run doctor');
      console.warn('  =====================================\n');
    } else {
      console.log('✅ Tenant integrity OK (all tenant-scoped records have a tenantId).');
    }
  } catch (err) {
    // Never block startup on the integrity check.
    console.warn('[tenant-integrity] check skipped:', err.message);
  }
}

module.exports = {
  NO_TENANT_MESSAGE,
  pickHealableTenant,
  findHealableTenant,
  healUserTenant,
  scanMissingTenantId,
  logTenantIntegrityWarnings,
};

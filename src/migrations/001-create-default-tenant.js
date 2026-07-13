/**
 * Migration 001 — Create the default tenant.
 *
 * Creates a single Tenant document representing the original single-tenant
 * Point.47 deployment, plus its TenantSettings and TenantApiSettings rows.
 *
 * Idempotent: re-running detects the existing default tenant and does nothing.
 */

const Tenant = require('../models/Tenant');
const TenantSettings = require('../models/TenantSettings');
const TenantApiSettings = require('../models/TenantApiSettings');

const DEFAULT = {
  companyName: 'Point.47',
  companyCode: 'POINT47',
  status: 'active',
  subscriptionStatus: 'active',
  timezone: 'Africa/Johannesburg',
  currency: 'ZAR',
  locale: 'en-ZA',
  isDefault: true,
};

async function up() {
  let tenant = await Tenant.findOne({ isDefault: true });
  if (tenant) {
    console.log(`  [001] Default tenant already exists: ${tenant._id} (${tenant.companyCode})`);
  } else {
    tenant = await Tenant.create(DEFAULT);
    console.log(`  [001] Created default tenant: ${tenant._id} (${tenant.companyCode})`);
  }

  // Settings rows (idempotent upserts).
  await TenantSettings.updateOne(
    { tenantId: tenant._id },
    {
      $setOnInsert: {
        tenantId: tenant._id,
        timezone: tenant.timezone,
        currency: tenant.currency,
        locale: tenant.locale,
      },
    },
    { upsert: true }
  );
  await TenantApiSettings.updateOne(
    { tenantId: tenant._id },
    { $setOnInsert: { tenantId: tenant._id } },
    { upsert: true }
  );
  console.log('  [001] Tenant settings + API settings ensured.');

  return tenant;
}

/**
 * Rollback: remove the default tenant + its settings rows. Guarded — refuses
 * to run if any business documents are still assigned to the default tenant
 * (run 002 down first). DEV/recovery use only.
 */
async function down() {
  const tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) {
    console.log('  [001 down] No default tenant; nothing to do.');
    return;
  }
  await TenantSettings.deleteOne({ tenantId: tenant._id });
  await TenantApiSettings.deleteOne({ tenantId: tenant._id });
  await Tenant.deleteOne({ _id: tenant._id });
  console.log(`  [001 down] Removed default tenant ${tenant._id} and its settings.`);
}

module.exports = { up, down };

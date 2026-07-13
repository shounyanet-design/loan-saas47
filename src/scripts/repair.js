#!/usr/bin/env node
/**
 * Tenant Repair — idempotent, safe remediation of multi-tenant data drift.
 *
 *   npm run repair
 *
 * Re-applies the SAFE, idempotent subset of the SaaS migrations to fix the most
 * common production issues without a full migration run:
 *   • Missing default tenant            -> migration 001 (create-default-tenant + settings)
 *   • Records missing tenantId          -> migration 002 (backfill-tenantId)
 *   • Tenants without a subscription    -> migration 005 (subscribe-existing-tenants)
 *   • Tenants without a wallet          -> migration 006 (create-wallets)
 *
 * Every step is idempotent (only fills gaps), so this is safe to run repeatedly
 * and safe to run in production. It does NOT delete or overwrite existing data.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const loadAllModels = require('../migrations/_loadModels');
const tenantContext = require('../tenancy/tenantContext');
const { scanMissingTenantId } = require('../tenancy/tenantHealing');

// The idempotent, gap-filling migrations (in dependency order).
const STEPS = [
  { name: '001-create-default-tenant', mod: require('../migrations/001-create-default-tenant') },
  { name: '002-backfill-tenantId', mod: require('../migrations/002-backfill-tenantId') },
  { name: '005-subscribe-existing-tenants', mod: require('../migrations/005-subscribe-existing-tenants') },
  { name: '006-create-wallets', mod: require('../migrations/006-create-wallets') },
];

async function main() {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }
  loadAllModels();
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected (${mongoose.connection.name}) — running idempotent repair\n`);

  await tenantContext.runAsSystem(async () => {
    const before = await scanMissingTenantId();
    console.log(`Before: ${before.totalMissing} record(s) missing tenantId`);

    for (const { name, mod } of STEPS) {
      if (typeof mod.up !== 'function') { console.log(`⏭  ${name}: no up() — skipping`); continue; }
      console.log(`▶ ${name} ...`);
      // eslint-disable-next-line no-await-in-loop
      await mod.up();
    }

    const after = await scanMissingTenantId();
    console.log(`\nAfter: ${after.totalMissing} record(s) missing tenantId`);
    if (after.totalMissing > 0) {
      console.log('⚠️  Some records still missing tenantId:');
      after.models.filter((m) => m.missing > 0).forEach((m) => console.log(`   • ${m.name}: ${m.missing}`));
      console.log('   (These may belong to a non-default tenant or a model not covered by backfill — inspect with `npm run doctor`.)');
    }
  });

  console.log('\n✅ Repair complete (idempotent).');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('\n❌ Repair failed:', e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });

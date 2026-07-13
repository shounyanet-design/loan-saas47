#!/usr/bin/env node
/**
 * Tenant Doctor — read-only health diagnostics for the multi-tenant data layer.
 *
 *   npm run doctor
 *
 * Verifies tenants exist, a default tenant is set, no tenant-scoped records are
 * missing tenantId, and that each tenant has its wallet / subscription / settings.
 * Prints a formatted report. Exit code 0 = healthy, 1 = issues found. Never writes.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const loadAllModels = require('../migrations/_loadModels');
const tenantContext = require('../tenancy/tenantContext');
const { scanMissingTenantId } = require('../tenancy/tenantHealing');

const ok = (s) => `✔ ${s}`;
const bad = (s) => `✘ ${s}`;

async function countSafe(modelName, filter = {}) {
  const Model = mongoose.models[modelName];
  if (!Model) return null; // model not present in this build
  return Model.collection.countDocuments(filter);
}

async function main() {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI not set'); process.exit(1); }
  loadAllModels();
  await mongoose.connect(process.env.MONGO_URI);

  const issues = [];
  const lines = [];

  await tenantContext.runAsSystem(async () => {
    const Tenant = mongoose.models.Tenant;
    const tenantCount = await Tenant.collection.countDocuments({});
    const defaultCount = await Tenant.collection.countDocuments({ isDefault: true });

    lines.push('── Tenancy ──');
    lines.push(tenantCount > 0 ? ok(`Tenants exist (${tenantCount})`) : bad('No tenants exist'));
    if (tenantCount === 0) issues.push('no tenants');
    if (defaultCount === 1) lines.push(ok('Exactly one default tenant'));
    else if (defaultCount === 0) { lines.push(bad('No default tenant')); issues.push('no default tenant'); }
    else { lines.push(bad(`Multiple default tenants (${defaultCount})`)); issues.push('multiple default tenants'); }

    lines.push('\n── tenantId coverage (records missing tenantId) ──');
    const scan = await scanMissingTenantId();
    if (scan.totalMissing === 0) lines.push(ok('All tenant-scoped records have a tenantId'));
    for (const m of scan.models) {
      if (m.missing > 0) { lines.push(bad(`${m.name}: ${m.missing}/${m.total} missing tenantId`)); issues.push(`${m.name} missing tenantId`); }
    }

    lines.push('\n── Per-tenant resources ──');
    const wallets = await countSafe('Wallet');
    const subs = await countSafe('TenantSubscription');
    const settings = await countSafe('TenantSettings');
    const apiSettings = await countSafe('TenantApiSettings');
    const report = (label, n) => {
      if (n === null) { lines.push(`  – ${label}: model not present`); return; }
      const enough = n >= tenantCount && tenantCount > 0;
      lines.push((enough ? ok : bad)(`${label}: ${n} (tenants: ${tenantCount})`));
      if (!enough && tenantCount > 0) issues.push(`${label} count < tenants`);
    };
    report('Wallets', wallets);
    report('Subscriptions', subs);
    report('Tenant Settings', settings);
    report('Tenant API Settings', apiSettings);
  });

  console.log('\n========== TENANT DOCTOR ==========');
  console.log(lines.join('\n'));
  console.log('\n-----------------------------------');
  if (issues.length === 0) {
    console.log('✅ Healthy — no tenant issues found.');
  } else {
    console.log(`❌ ${issues.length} issue(s) found. Run \`npm run repair\` to remediate.`);
  }
  console.log('===================================\n');

  await mongoose.disconnect();
  process.exit(issues.length ? 1 : 0);
}

main().catch(async (e) => { console.error('doctor failed:', e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });

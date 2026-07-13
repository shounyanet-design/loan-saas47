/**
 * Migration 005 — Subscribe pre-existing tenants to the Grandfathered plan.
 *
 * Guarantees backward compatibility: every existing tenant gets an active,
 * unlimited subscription so the license guard / limit engine never blocks them.
 * Idempotent: only tenants WITHOUT a subscription are touched.
 */
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const TenantSubscription = require('../models/TenantSubscription');
const SubscriptionHistory = require('../models/SubscriptionHistory');

async function up() {
  const plan = await SubscriptionPlan.findOne({ code: 'GRANDFATHERED' });
  if (!plan) throw new Error('[005] GRANDFATHERED plan missing — run 004 first.');

  const tenants = await Tenant.find({}).select('_id companyCode').lean();
  const farFuture = new Date('2999-12-31T00:00:00Z');
  const summary = [];

  for (const t of tenants) {
    // Native upsert that does nothing if a subscription already exists.
    const existing = await TenantSubscription.collection.findOne({ tenantId: t._id });
    if (existing) { summary.push({ tenant: t.companyCode, action: 'exists' }); continue; }

    const now = new Date();
    await TenantSubscription.collection.insertOne({
      tenantId: t._id,
      planId: plan._id,
      subscriptionType: 'custom',
      status: 'active',
      autoRenew: true,
      billingCycle: 'none',
      subscriptionStart: now,
      subscriptionEnd: farFuture,
      renewalDate: farFuture,
      createdAt: now,
      updatedAt: now,
    });
    await SubscriptionHistory.collection.insertOne({
      tenantId: t._id, planId: plan._id, event: 'create', actor: 'migration:005',
      note: 'Grandfathered existing tenant', createdAt: now, updatedAt: now,
    });
    summary.push({ tenant: t.companyCode, action: 'subscribed' });
  }
  console.table(summary);
  return summary;
}

async function down() {
  // Remove only the migration-created grandfathered subscriptions.
  const plan = await SubscriptionPlan.findOne({ code: 'GRANDFATHERED' });
  if (!plan) return;
  await TenantSubscription.collection.deleteMany({ planId: plan._id, subscriptionType: 'custom' });
  await SubscriptionHistory.collection.deleteMany({ actor: 'migration:005' });
}

module.exports = { up, down };

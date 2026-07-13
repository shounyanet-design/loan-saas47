/**
 * Migration 004 — Seed subscription plans (idempotent, additive).
 *
 * Upserts a public catalog (Free / Starter / Professional / Enterprise) plus an
 * INTERNAL "Grandfathered" plan (all features, unlimited limits) used to keep
 * pre-existing tenants fully functional. Re-running only fills gaps.
 */
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { FEATURES } = require('../modules/saas/services/featureService');
const TenantApiSettings = require('../models/TenantApiSettings');

const ALL_INTEGRATIONS = TenantApiSettings.PROVIDERS;

const PLANS = [
  {
    code: 'GRANDFATHERED', name: 'Grandfathered (Unlimited)', isInternal: true, status: 'active', sortOrder: 99,
    description: 'Internal plan for pre-existing tenants — unlimited everything.',
    monthlyPrice: 0, yearlyPrice: 0, trialDays: 0,
    enabledFeatures: FEATURES, enabledModules: FEATURES, enabledIntegrations: ALL_INTEGRATIONS,
  },
  {
    code: 'FREE', name: 'Free', status: 'active', sortOrder: 1, monthlyPrice: 0, yearlyPrice: 0, trialDays: 0,
    description: 'Get started with the essentials.',
    maximumStaff: 2, maximumBorrowers: 50, maximumLoans: 50, maximumStorageGB: 1, maximumApiCalls: 1000,
    maximumSms: 50, maximumEmails: 200, maximumOcr: 20, maximumAml: 10, maximumCreditReports: 10, maximumFaceVerifications: 10, maximumDocuments: 200, maximumBranches: 1,
    enabledModules: ['LOANS', 'BORROWERS', 'DASHBOARD', 'SETTINGS'],
    enabledFeatures: ['LOANS', 'BORROWERS', 'DASHBOARD', 'SETTINGS', 'REPORTS'],
    enabledIntegrations: [],
  },
  {
    code: 'STARTER', name: 'Starter', status: 'active', sortOrder: 2, monthlyPrice: 499, yearlyPrice: 4990, trialDays: 14,
    description: 'For small lenders growing their book.',
    maximumStaff: 5, maximumBorrowers: 500, maximumLoans: 1000, maximumStorageGB: 10, maximumApiCalls: 25000,
    maximumSms: 1000, maximumEmails: 5000, maximumOcr: 500, maximumAml: 250, maximumCreditReports: 250, maximumFaceVerifications: 250, maximumDocuments: 5000, maximumBranches: 3,
    enabledModules: ['LOANS', 'BORROWERS', 'STAFF', 'DASHBOARD', 'SETTINGS'],
    enabledFeatures: ['LOANS', 'BORROWERS', 'STAFF', 'DASHBOARD', 'SETTINGS', 'REPORTS', 'EXPORT', 'SMS', 'EMAIL', 'OCR', 'PHONE_VERIFICATION'],
    enabledIntegrations: ['bulksms', 'emailjs', 'imagekit'],
  },
  {
    code: 'PROFESSIONAL', name: 'Professional', status: 'active', sortOrder: 3, isPopular: true, monthlyPrice: 1499, yearlyPrice: 14990, trialDays: 14,
    description: 'Full verification suite for scaling lenders.',
    maximumStaff: 25, maximumBorrowers: 5000, maximumLoans: 20000, maximumStorageGB: 50, maximumApiCalls: 150000,
    maximumSms: 10000, maximumEmails: 50000, maximumOcr: 5000, maximumAml: 2500, maximumCreditReports: 2500, maximumFaceVerifications: 2500, maximumDocuments: 50000, maximumBranches: 10,
    enabledModules: ['LOANS', 'BORROWERS', 'STAFF', 'AGENTS', 'DASHBOARD', 'SETTINGS'],
    enabledFeatures: ['LOANS', 'BORROWERS', 'STAFF', 'AGENTS', 'DASHBOARD', 'SETTINGS', 'REPORTS', 'EXPORT', 'API', 'SMS', 'EMAIL', 'OCR', 'AML', 'CREDIT_BUREAU', 'PHONE_VERIFICATION', 'BANK_VERIFICATION', 'FACE_VERIFICATION'],
    enabledIntegrations: ['bulksms', 'emailjs', 'imagekit', 'datanamix', 'facetec'],
  },
  {
    code: 'ENTERPRISE', name: 'Enterprise', status: 'active', sortOrder: 4, monthlyPrice: 0, yearlyPrice: 0, trialDays: 30,
    description: 'Unlimited scale, white-label, and dedicated support.',
    maximumStaff: -1, maximumBorrowers: -1, maximumLoans: -1, maximumStorageGB: -1, maximumApiCalls: -1,
    maximumSms: -1, maximumEmails: -1, maximumOcr: -1, maximumAml: -1, maximumCreditReports: -1, maximumFaceVerifications: -1, maximumDocuments: -1, maximumBranches: -1,
    enabledModules: FEATURES, enabledFeatures: FEATURES, enabledIntegrations: ALL_INTEGRATIONS,
  },
];

async function up() {
  const summary = [];
  for (const p of PLANS) {
    const existing = await SubscriptionPlan.findOne({ code: p.code });
    if (existing) { summary.push({ code: p.code, action: 'exists' }); continue; }
    await SubscriptionPlan.create(p);
    summary.push({ code: p.code, action: 'created' });
  }
  console.table(summary);
  return summary;
}

async function down() {
  // Only removes plans NOT in use (safe). Used plans are left intact.
  const TenantSubscription = require('../models/TenantSubscription');
  const tenantContext = require('../tenancy/tenantContext');
  for (const p of PLANS) {
    const plan = await SubscriptionPlan.findOne({ code: p.code });
    if (!plan) continue;
    const inUse = await tenantContext.runAsSystem(() => TenantSubscription.countDocuments({ planId: plan._id }));
    if (inUse === 0) await SubscriptionPlan.deleteOne({ _id: plan._id });
  }
}

module.exports = { up, down, PLANS };

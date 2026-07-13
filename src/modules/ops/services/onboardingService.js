const crypto = require('crypto');
const tenantContext = require('../../../tenancy/tenantContext');
const OnboardingSession = require('../models/OnboardingSession');
const Tenant = require('../../../models/Tenant');
const User = require('../../../models/User');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const TenantSettings = require('../../../models/TenantSettings');
const subscriptionController = require('../../saas/controllers/subscriptionController');
const walletService = require('../../commerce/services/walletService');
const logger = require('./loggingService');

const token = () => crypto.randomBytes(16).toString('hex');

async function uniqueCompanyCode(base) {
  let code = String(base).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TENANT';
  let candidate = code; let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Tenant.findOne({ companyCode: candidate })) { candidate = `${code}${n++}`; }
  return candidate;
}

function mark(session, step) {
  if (!session.completedSteps.includes(step)) session.completedSteps.push(step);
}

// Step 1
async function start({ email, companyName }) {
  if (!email || !companyName) throw Object.assign(new Error('email and companyName are required'), { status: 400 });
  return tenantContext.runAsSystem(async () => {
    const session = await OnboardingSession.create({
      sessionId: token(), email: String(email).toLowerCase(), companyName,
      currentStep: 'verify_email', verifyToken: token(), data: { companyName },
    });
    mark(session, 'company'); await session.save();
    logger.info('tenant_activity', `Onboarding started for ${email}`, {});
    // verifyToken is returned for the wizard; in production it is emailed.
    return { sessionId: session.sessionId, verifyToken: session.verifyToken, currentStep: session.currentStep };
  });
}

async function getSession(sessionId) {
  const s = await tenantContext.runAsSystem(() => OnboardingSession.findOne({ sessionId }));
  if (!s) throw Object.assign(new Error('Onboarding session not found'), { status: 404 });
  return s;
}

// Step 2
async function verifyEmail(sessionId, providedToken) {
  return tenantContext.runAsSystem(async () => {
    const s = await getSession(sessionId);
    if (s.verifyToken !== providedToken) throw Object.assign(new Error('Invalid verification token'), { status: 400 });
    s.emailVerified = true; mark(s, 'verify_email'); s.currentStep = 'select_plan'; await s.save();
    return { currentStep: s.currentStep };
  });
}

// Step 3
async function selectPlan(sessionId, planCode) {
  return tenantContext.runAsSystem(async () => {
    const s = await getSession(sessionId);
    if (!s.emailVerified) throw Object.assign(new Error('Email not verified'), { status: 400 });
    const plan = await SubscriptionPlan.findOne({ code: String(planCode).toUpperCase(), status: 'active' });
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
    s.planId = plan._id; mark(s, 'select_plan'); s.currentStep = 'create_tenant'; await s.save();
    return { currentStep: s.currentStep, plan: { code: plan.code, name: plan.name } };
  });
}

/**
 * Step 4 — provision everything. Fully RESUMABLE & idempotent: each sub-step is
 * skipped if already in completedSteps, so a re-invoke after an interruption
 * continues where it left off.
 */
async function provision(sessionId, { adminFullName, adminEmail, adminPassword, branding } = {}) {
  return tenantContext.runAsSystem(async () => {
    const s = await getSession(sessionId);
    if (!s.planId) throw Object.assign(new Error('Plan not selected'), { status: 400 });

    // 4a. Create tenant
    if (!s.completedSteps.includes('create_tenant')) {
      const code = await uniqueCompanyCode(s.companyName);
      const tenant = await Tenant.create({ companyName: s.companyName, companyCode: code, status: 'trial', email: s.email });
      await TenantSettings.updateOne({ tenantId: tenant._id }, { $setOnInsert: { tenantId: tenant._id } }, { upsert: true });
      s.tenantId = tenant._id; mark(s, 'create_tenant'); s.currentStep = 'create_admin'; await s.save();
    }

    // 4b. Create admin user (inside the tenant context so it is stamped)
    if (!s.completedSteps.includes('create_admin')) {
      if (!adminEmail || !adminPassword) throw Object.assign(new Error('adminEmail and adminPassword required'), { status: 400 });
      const user = await tenantContext.runWithTenant(s.tenantId, () =>
        User.create({ fullName: adminFullName || 'Administrator', email: String(adminEmail).toLowerCase(), phone: '0000000000', password: adminPassword, role: 'admin' }));
      s.adminUserId = user._id; mark(s, 'create_admin'); s.currentStep = 'assign_subscription'; await s.save();
    }

    // 4c. Assign subscription
    if (!s.completedSteps.includes('assign_subscription')) {
      const plan = await SubscriptionPlan.findById(s.planId);
      await subscriptionController.assignPlan({ tenantId: s.tenantId, planId: s.planId, type: plan.trialDays > 0 ? 'trial' : 'monthly', actor: 'onboarding' });
      mark(s, 'assign_subscription'); s.currentStep = 'create_wallet'; await s.save();
    }

    // 4d. Create wallet (+ optional welcome bonus tokens)
    if (!s.completedSteps.includes('create_wallet')) {
      await walletService.getOrCreate(s.tenantId);
      const bonus = Number(process.env.ONBOARDING_BONUS_TOKENS || 100);
      if (bonus > 0) await walletService.credit(s.tenantId, bonus, { type: 'bonus', bonus: true, reason: 'Welcome bonus', idempotencyKey: `onboard-bonus:${s.tenantId}` });
      mark(s, 'create_wallet'); s.currentStep = 'seed_data'; await s.save();
    }

    // 4e. Seed default data (settings already created; placeholder for future seeds)
    if (!s.completedSteps.includes('seed_data')) {
      mark(s, 'seed_data'); s.currentStep = 'branding'; await s.save();
    }

    // 4f. Branding
    if (!s.completedSteps.includes('branding')) {
      if (branding && typeof branding === 'object') {
        const set = {};
        for (const [k, v] of Object.entries(branding)) set[`branding.${k}`] = v;
        if (Object.keys(set).length) await TenantSettings.updateOne({ tenantId: s.tenantId }, { $set: set });
      }
      mark(s, 'branding'); s.currentStep = 'ready'; await s.save();
    }

    // 4g. Ready
    mark(s, 'ready'); s.status = 'completed'; s.completedAt = new Date(); await s.save();
    logger.info('tenant_activity', `Onboarding completed for tenant ${s.tenantId}`, { tenantId: String(s.tenantId) });
    return { status: 'completed', tenantId: s.tenantId, currentStep: 'ready', completedSteps: s.completedSteps };
  });
}

async function status(sessionId) {
  const s = await getSession(sessionId);
  return {
    sessionId: s.sessionId, currentStep: s.currentStep, completedSteps: s.completedSteps,
    status: s.status, emailVerified: s.emailVerified, tenantId: s.tenantId,
    steps: OnboardingSession.STEPS,
  };
}

module.exports = { start, verifyEmail, selectPlan, provision, status, getSession };

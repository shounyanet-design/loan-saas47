const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const TenantSubscription = require('../../../models/TenantSubscription');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const SubscriptionHistory = require('../../../models/SubscriptionHistory');
const TrialHistory = require('../../../models/TrialHistory');
const Tenant = require('../../../models/Tenant');
const tenantContext = require('../../../tenancy/tenantContext');
const { getEffectiveConfig } = require('../services/subscriptionService');
const { buildQuery, paginate } = require('../../platform/utils/queryFeatures');
const { audit } = require('../utils/auditAny');

function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

function computeDates(type, plan) {
  const now = new Date();
  if (type === 'trial') {
    const days = plan.trialDays || 14;
    const end = new Date(now); end.setDate(end.getDate() + days);
    return { subscriptionType: 'trial', status: 'trialing', billingCycle: 'none', trialStart: now, trialEnd: end, renewalDate: end, nextInvoiceDate: end };
  }
  const end = addMonths(now, type === 'yearly' ? 12 : 1);
  return { subscriptionType: type, status: 'active', billingCycle: type, subscriptionStart: now, subscriptionEnd: end, renewalDate: end, nextInvoiceDate: end };
}

/** Core: assign/replace a tenant's plan (platform, SYSTEM mode). */
async function assignPlan({ tenantId, planId, type = 'trial', actor }) {
  return tenantContext.runAsSystem(async () => {
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });

    const existing = await TenantSubscription.findOne({ tenantId });
    const dates = computeDates(type, plan);
    let event = 'create';
    if (existing) {
      const prevPlan = await SubscriptionPlan.findById(existing.planId).lean();
      event = (prevPlan && plan.monthlyPrice < prevPlan.monthlyPrice) ? 'downgrade' : (prevPlan && plan.monthlyPrice > prevPlan.monthlyPrice ? 'upgrade' : 'renew');
    }

    const sub = await TenantSubscription.findOneAndUpdate(
      { tenantId },
      { $set: { tenantId, planId: plan._id, autoRenew: true, cancelReason: undefined, ...dates } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    await SubscriptionHistory.create({ tenantId, planId: plan._id, fromPlanId: existing ? existing.planId : undefined, event, actor, snapshot: sub.toObject() });
    if (type === 'trial') {
      await TrialHistory.create({ tenantId, planId: plan._id, trialStart: dates.trialStart, trialEnd: dates.trialEnd, outcome: 'active' });
    }
    // Keep tenant.subscriptionStatus roughly in sync (best-effort).
    await Tenant.updateOne({ _id: tenantId }, { $set: { subscriptionStatus: type === 'trial' ? 'trialing' : 'active' } });
    return { sub, event, plan };
  });
}

// ---------------- PLATFORM ----------------

// @route GET /api/platform/subscriptions
exports.listAll = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    filterFields: ['status', 'subscriptionType', 'planId'],
    sortFields: ['createdAt', 'status', 'subscriptionEnd'],
    defaultSort: 'createdAt',
  });
  const [items, total] = await tenantContext.runAsSystem(() => Promise.all([
    TenantSubscription.find(filter).populate('planId', 'name code monthlyPrice').sort(sort).skip(skip).limit(limit).lean(),
    TenantSubscription.countDocuments(filter),
  ]));
  return sendSuccess(res, 'Subscriptions', paginate(items, total, page, limit));
});

// @route GET /api/platform/subscriptions/:tenantId
exports.getForTenant = asyncHandler(async (req, res) => {
  const cfg = await getEffectiveConfig({ tenantId: req.params.tenantId });
  return sendSuccess(res, 'Tenant subscription', cfg);
});

// @route POST /api/platform/subscriptions/:tenantId  { planId, type }
exports.assign = asyncHandler(async (req, res) => {
  const { planId, type } = req.body;
  if (!planId) return sendError(res, 'planId is required', 400);
  try {
    const { sub, event, plan } = await assignPlan({ tenantId: req.params.tenantId, planId, type, actor: req.platformUser?.email || 'platform' });
    await audit(req, { action: `SUBSCRIPTION_${event.toUpperCase()}`, entity: 'TenantSubscription', entityId: req.params.tenantId, newValues: { plan: plan.code, type } });
    return sendSuccess(res, `Subscription ${event}`, sub);
  } catch (e) {
    return sendError(res, e.message, e.status || 500);
  }
});

// @route PATCH /api/platform/subscriptions/:tenantId/cancel
exports.cancel = asyncHandler(async (req, res) => {
  const sub = await tenantContext.runAsSystem(async () => {
    const s = await TenantSubscription.findOne({ tenantId: req.params.tenantId });
    if (!s) return null;
    s.status = 'canceled'; s.autoRenew = false; s.cancelReason = req.body.reason || 'Canceled by platform';
    await s.save();
    await SubscriptionHistory.create({ tenantId: req.params.tenantId, planId: s.planId, event: 'cancel', actor: req.platformUser?.email, note: s.cancelReason });
    return s;
  });
  if (!sub) return sendError(res, 'Subscription not found', 404);
  await audit(req, { action: 'SUBSCRIPTION_CANCEL', entity: 'TenantSubscription', entityId: req.params.tenantId });
  return sendSuccess(res, 'Subscription canceled', sub);
});

// @route PATCH /api/platform/subscriptions/:tenantId/resume
exports.resume = asyncHandler(async (req, res) => {
  const sub = await tenantContext.runAsSystem(async () => {
    const s = await TenantSubscription.findOne({ tenantId: req.params.tenantId });
    if (!s) return null;
    const stillValid = s.subscriptionEnd && new Date(s.subscriptionEnd).getTime() > Date.now();
    s.status = stillValid ? 'active' : 'expired'; s.autoRenew = true; s.cancelReason = undefined;
    await s.save();
    await SubscriptionHistory.create({ tenantId: req.params.tenantId, planId: s.planId, event: 'resume', actor: req.platformUser?.email });
    return s;
  });
  if (!sub) return sendError(res, 'Subscription not found', 404);
  await audit(req, { action: 'SUBSCRIPTION_RESUME', entity: 'TenantSubscription', entityId: req.params.tenantId });
  return sendSuccess(res, 'Subscription resumed', sub);
});

// @route GET /api/platform/subscriptions/:tenantId/history
exports.history = asyncHandler(async (req, res) => {
  const items = await tenantContext.runAsSystem(() => SubscriptionHistory.find({ tenantId: req.params.tenantId }).populate('planId', 'name code').sort({ createdAt: -1 }).lean());
  return sendSuccess(res, 'Subscription history', items);
});

// ---------------- TENANT (self) ----------------

// @route GET /api/tenant/subscription
exports.mySubscription = asyncHandler(async (req, res) => {
  const cfg = await getEffectiveConfig({ tenantId: req.tenantId });
  return sendSuccess(res, 'My subscription', cfg);
});

// @route PATCH /api/tenant/subscription/auto-renew  { autoRenew }
exports.setAutoRenew = asyncHandler(async (req, res) => {
  const s = await TenantSubscription.findOne({});
  if (!s) return sendError(res, 'No subscription found', 404);
  s.autoRenew = !!req.body.autoRenew;
  await s.save();
  await audit(req, { action: 'SUBSCRIPTION_AUTORENEW_TOGGLED', entity: 'TenantSubscription', entityId: req.tenantId, newValues: { autoRenew: s.autoRenew } });
  return sendSuccess(res, 'Auto-renew updated', { autoRenew: s.autoRenew });
});

exports.assignPlan = assignPlan; // exported for migrations/tests

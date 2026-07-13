const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const { buildQuery, paginate } = require('../../platform/utils/queryFeatures');
const { audit } = require('../utils/auditAny');

// @route GET /api/platform/plans  (super admin)
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['name', 'code', 'description'],
    filterFields: ['status'],
    sortFields: ['sortOrder', 'name', 'monthlyPrice', 'createdAt'],
    defaultSort: 'sortOrder',
  });
  const [items, total] = await Promise.all([
    SubscriptionPlan.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    SubscriptionPlan.countDocuments(filter),
  ]);
  return sendSuccess(res, 'Plans', paginate(items, total, page, limit));
});

// @route GET /api/platform/plans/public  (public catalog — active, non-internal)
exports.listPublic = asyncHandler(async (req, res) => {
  const items = await SubscriptionPlan.find({ status: 'active', isInternal: { $ne: true } }).sort({ sortOrder: 1 }).lean();
  return sendSuccess(res, 'Public plans', items);
});

exports.getOne = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id).lean();
  if (!plan) return sendError(res, 'Plan not found', 404);
  return sendSuccess(res, 'Plan', plan);
});

exports.create = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.code) return sendError(res, 'name and code are required', 400);
  const code = String(req.body.code).toUpperCase().trim();
  if (await SubscriptionPlan.findOne({ code })) return sendError(res, 'Plan code already exists', 409);
  const plan = await SubscriptionPlan.create({ ...req.body, code });
  await audit(req, { action: 'PLAN_CREATED', entity: 'SubscriptionPlan', entityId: plan._id, newValues: plan.toObject() });
  return sendSuccess(res, 'Plan created', plan, 201);
});

exports.update = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) return sendError(res, 'Plan not found', 404);
  const before = plan.toObject();
  const editable = ['name', 'description', 'monthlyPrice', 'yearlyPrice', 'currency', 'trialDays',
    'maximumStaff', 'maximumBorrowers', 'maximumLoans', 'maximumBranches', 'maximumStorageGB', 'maximumApiCalls',
    'maximumSms', 'maximumEmails', 'maximumOcr', 'maximumAml', 'maximumCreditReports', 'maximumFaceVerifications', 'maximumDocuments',
    'enabledModules', 'enabledIntegrations', 'enabledFeatures', 'status', 'sortOrder', 'isPopular'];
  editable.forEach((f) => { if (req.body[f] !== undefined) plan[f] = req.body[f]; });
  await plan.save();
  await audit(req, { action: 'PLAN_UPDATED', entity: 'SubscriptionPlan', entityId: plan._id, oldValues: before, newValues: plan.toObject() });
  return sendSuccess(res, 'Plan updated', plan);
});

// Soft archive by default; hard delete blocked if plan is in use.
exports.remove = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) return sendError(res, 'Plan not found', 404);
  const TenantSubscription = require('../../../models/TenantSubscription');
  const tenantContext = require('../../../tenancy/tenantContext');
  const inUse = await tenantContext.runAsSystem(() => TenantSubscription.countDocuments({ planId: plan._id }));
  if (inUse > 0) {
    plan.status = 'archived';
    await plan.save();
    await audit(req, { action: 'PLAN_ARCHIVED', entity: 'SubscriptionPlan', entityId: plan._id });
    return sendSuccess(res, `Plan archived (in use by ${inUse} tenant(s))`, plan);
  }
  await SubscriptionPlan.deleteOne({ _id: plan._id });
  await audit(req, { action: 'PLAN_DELETED', entity: 'SubscriptionPlan', entityId: plan._id, oldValues: plan.toObject() });
  return sendSuccess(res, 'Plan deleted', { _id: plan._id });
});

const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/responseHandler');
const OnboardingSession = require('../../ops/models/OnboardingSession');
const { buildQuery, paginate } = require('../utils/queryFeatures');

// Leads = tenant onboarding/signup attempts (the OnboardingSession pipeline).
// These exist BEFORE a tenant is created, so they are NOT tenant-scoped; the
// queries run in SYSTEM mode (set by protectPlatform) and see all sessions.

// @route GET /api/platform/leads
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['email', 'companyName', 'sessionId'],
    filterFields: ['status', 'currentStep', 'emailVerified'],
    sortFields: ['createdAt', 'updatedAt', 'status', 'currentStep', 'companyName', 'email'],
    defaultSort: 'createdAt',
  });

  const [items, total] = await Promise.all([
    OnboardingSession.find(filter)
      .sort(sort).skip(skip).limit(limit)
      .populate('planId', 'name code')
      .populate('tenantId', 'companyName companyCode status')
      .select('-verifyToken') // never expose the email-verification token
      .lean(),
    OnboardingSession.countDocuments(filter),
  ]);

  return sendSuccess(res, 'Onboarding leads', paginate(items, total, page, limit));
});

// @route GET /api/platform/leads/stats
// Small summary for the header cards.
exports.stats = asyncHandler(async (req, res) => {
  const [total, inProgress, completed, abandoned, verified] = await Promise.all([
    OnboardingSession.countDocuments({}),
    OnboardingSession.countDocuments({ status: 'in_progress' }),
    OnboardingSession.countDocuments({ status: 'completed' }),
    OnboardingSession.countDocuments({ status: 'abandoned' }),
    OnboardingSession.countDocuments({ emailVerified: true }),
  ]);
  return sendSuccess(res, 'Lead stats', { total, inProgress, completed, abandoned, verified });
});

const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const onboardingService = require('../services/onboardingService');

const wrap = (fn) => asyncHandler(async (req, res) => {
  try { return sendSuccess(res, 'OK', await fn(req)); }
  catch (e) { return sendError(res, e.message, e.status || 500); }
});

// Public, unauthenticated onboarding wizard (Part 3).
exports.start = wrap((req) => onboardingService.start({ email: req.body.email, companyName: req.body.companyName }));
exports.verifyEmail = wrap((req) => onboardingService.verifyEmail(req.body.sessionId, req.body.token));
exports.selectPlan = wrap((req) => onboardingService.selectPlan(req.body.sessionId, req.body.planCode));
exports.provision = wrap((req) => onboardingService.provision(req.body.sessionId, {
  adminFullName: req.body.adminFullName, adminEmail: req.body.adminEmail, adminPassword: req.body.adminPassword, branding: req.body.branding,
}));
exports.status = wrap((req) => onboardingService.status(req.params.sessionId));

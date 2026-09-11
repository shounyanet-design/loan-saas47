const asyncHandler = require('express-async-handler');
const CollectionAttempt = require('../../models/CollectionAttempt');

/**
 * @desc Get all loan collection attempts for current tenant
 * @route GET /api/admin/loan-collections
 * @access Private (Admin/Staff)
 */
const getCollectionAttempts = asyncHandler(async (req, res) => {
  const { status, provider, collectionMethod, repaymentScheduleId, loanId, borrowerId, limit = 50, page = 1 } = req.query;

  const query = {};
  if (status) query.status = status;
  if (provider) query.provider = provider;
  if (collectionMethod) query.collectionMethod = collectionMethod;
  if (repaymentScheduleId) query.repaymentScheduleId = repaymentScheduleId;
  if (loanId) query.loanId = loanId;
  if (borrowerId) query.borrowerId = borrowerId;

  const skip = (Number(page) - 1) * Number(limit);

  const [attempts, total] = await Promise.all([
    CollectionAttempt.find(query)
      .populate('borrowerId', 'fullName idNumber email phoneNumber')
      .populate('loanId', 'loanCode loanStatus')
      .populate('repaymentScheduleId', 'emiNumber dueDate amount status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    CollectionAttempt.countDocuments(query)
  ]);

  res.status(200).json({
    success: true,
    data: attempts,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit))
    }
  });
});

/**
 * @desc Get single loan collection attempt details
 * @route GET /api/admin/loan-collections/:id
 * @access Private (Admin/Staff)
 */
const getCollectionAttemptById = asyncHandler(async (req, res) => {
  const attempt = await CollectionAttempt.findById(req.params.id)
    .populate('borrowerId', 'fullName idNumber email phoneNumber collectionProfile')
    .populate('loanId', 'loanCode loanStatus')
    .populate('repaymentScheduleId', 'emiNumber dueDate amount status')
    .populate('originalAttemptId')
    .populate('fallbackAttemptId')
    .lean();

  if (!attempt) {
    return res.status(404).json({ success: false, message: 'CollectionAttempt not found' });
  }

  res.status(200).json({
    success: true,
    data: attempt
  });
});

/**
 * @desc Get aggregated loan collection statistics for admin monitoring
 * @route GET /api/admin/loan-collections/stats
 * @access Private (Admin/Staff)
 */
const getCollectionDashboardStats = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    todayCount,
    trackingCount,
    successfulCount,
    unsuccessfulCount,
    payfastFallbackCount,
    fallbackFailedCount,
    pendingCount,
    requiresAttentionCount
  ] = await Promise.all([
    CollectionAttempt.countDocuments({ tenantId, createdAt: { $gte: startOfToday } }),
    CollectionAttempt.countDocuments({ tenantId, status: 'TRACKING' }),
    CollectionAttempt.countDocuments({ tenantId, status: { $in: ['SUCCESSFUL', 'SUCCESS'] } }),
    CollectionAttempt.countDocuments({ tenantId, status: 'UNSUCCESSFUL' }),
    CollectionAttempt.countDocuments({ tenantId, provider: 'PAYFAST', collectionMethod: 'PAYFAST_CARD' }),
    CollectionAttempt.countDocuments({ tenantId, provider: 'PAYFAST', status: { $in: ['FAILED', 'EXHAUSTED'] } }),
    CollectionAttempt.countDocuments({ tenantId, status: { $in: ['PENDING', 'SUBMITTED', 'PROCESSING'] } }),
    CollectionAttempt.countDocuments({
      tenantId,
      $or: [
        { status: 'FAILED' },
        { fallbackStatus: 'EXHAUSTED' },
        { fallbackStatus: 'UNAVAILABLE' },
        { fallbackStatus: 'NOT_CONFIGURED' }
      ]
    })
  ]);

  res.status(200).json({
    success: true,
    data: {
      todaysCollections: todayCount,
      tracking: trackingCount,
      successful: successfulCount,
      unsuccessful: unsuccessfulCount,
      payfastFallback: payfastFallbackCount,
      fallbackFailed: fallbackFailedCount,
      pending: pendingCount,
      requiresAttention: requiresAttentionCount
    }
  });
});

/**
 * @desc Initiate borrower card authorization redirect for PayFast fallback
 * @route POST /api/admin/loan-collections/borrower/:borrowerId/authorize-card
 * @access Private (Admin/Staff)
 */
const initiateBorrowerCardAuth = asyncHandler(async (req, res) => {
  const payFastTokenizationService = require('../../modules/loanCollection/payFastTokenizationService');
  const result = await payFastTokenizationService.createBorrowerCardAuthorizationRequest(
    req.tenantId,
    req.params.borrowerId,
    req.body
  );

  res.status(200).json({
    success: true,
    message: 'Card authorization request created',
    data: result
  });
});

module.exports = {
  getCollectionAttempts,
  getCollectionAttemptById,
  getCollectionDashboardStats,
  initiateBorrowerCardAuth
};

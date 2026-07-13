const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess } = require('../../../utils/responseHandler');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const { buildQuery, paginate } = require('../utils/queryFeatures');

// @route GET /api/platform/audit-logs
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['action', 'entity', 'platformUserEmail'],
    filterFields: ['action', 'entity', 'platformUserId'],
    sortFields: ['createdAt', 'action', 'entity'],
    defaultSort: 'createdAt',
  });
  const [items, total] = await Promise.all([
    PlatformAuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    PlatformAuditLog.countDocuments(filter),
  ]);
  return sendSuccess(res, 'Audit logs', paginate(items, total, page, limit));
});

const asyncHandler = require('../../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../../utils/responseHandler');
const PlatformNotification = require('../models/PlatformNotification');
const { buildQuery, paginate } = require('../utils/queryFeatures');
const { recordAudit } = require('../utils/audit');

// A notification is visible to a platform user if it is a broadcast or targeted at them.
const visibleTo = (uid) => ({ $or: [{ isBroadcast: true }, { targetPlatformUserId: uid }] });
const withRead = (n, uid) => ({ ...n, isRead: (n.readBy || []).some((id) => String(id) === String(uid)) });

// @route GET /api/platform/notifications
exports.list = asyncHandler(async (req, res) => {
  const uid = req.platformUser._id;
  const { page, limit, skip, sort, filter } = buildQuery(req.query, {
    searchFields: ['title', 'message'],
    filterFields: ['type'],
    sortFields: ['createdAt', 'type'],
    defaultSort: 'createdAt',
  });
  const finalFilter = { ...filter, ...visibleTo(uid) };
  const [items, total] = await Promise.all([
    PlatformNotification.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
    PlatformNotification.countDocuments(finalFilter),
  ]);
  return sendSuccess(res, 'Notifications', paginate(items.map((n) => withRead(n, uid)), total, page, limit));
});

// @route GET /api/platform/notifications/unread-count
exports.unreadCount = asyncHandler(async (req, res) => {
  const uid = req.platformUser._id;
  const count = await PlatformNotification.countDocuments({ ...visibleTo(uid), readBy: { $ne: uid } });
  return sendSuccess(res, 'Unread count', { count });
});

// @route PATCH /api/platform/notifications/:id/read
exports.markRead = asyncHandler(async (req, res) => {
  const uid = req.platformUser._id;
  const n = await PlatformNotification.findOne({ _id: req.params.id, ...visibleTo(uid) });
  if (!n) return sendError(res, 'Notification not found', 404);
  await PlatformNotification.updateOne({ _id: n._id }, { $addToSet: { readBy: uid } });
  return sendSuccess(res, 'Marked as read');
});

// @route PATCH /api/platform/notifications/read-all
exports.markAllRead = asyncHandler(async (req, res) => {
  const uid = req.platformUser._id;
  await PlatformNotification.updateMany({ ...visibleTo(uid), readBy: { $ne: uid } }, { $addToSet: { readBy: uid } });
  return sendSuccess(res, 'All notifications marked as read');
});

// @route POST /api/platform/notifications  (create / broadcast)
exports.create = asyncHandler(async (req, res) => {
  const { type, title, message, isBroadcast, targetPlatformUserId } = req.body;
  if (!title) return sendError(res, 'title is required', 400);
  if (type && !['info', 'warning', 'error', 'success'].includes(type)) return sendError(res, 'invalid type', 400);
  const n = await PlatformNotification.create({
    type: type || 'info',
    title,
    message: message || '',
    isBroadcast: isBroadcast !== undefined ? !!isBroadcast : !targetPlatformUserId,
    targetPlatformUserId: targetPlatformUserId || undefined,
  });
  await recordAudit(req, { action: 'PLATFORM_NOTIFICATION_CREATED', entity: 'PlatformNotification', entityId: n._id, newValues: n.toObject() });
  return sendSuccess(res, 'Notification created', n, 201);
});

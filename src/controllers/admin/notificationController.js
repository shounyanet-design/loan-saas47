const Notification = require('../../models/Notification');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');

/**
 * @desc    Get all notifications (Admin)
 * @route   GET /api/admin/notifications
 * @access  Private/Admin
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 20, 
    status, 
    type, 
    search 
  } = req.query;

  const query = { 
    receiverRole: 'admin',
    isDeleted: false 
  };

  // Filter conditions
  if (status && status !== 'Status') {
    query.isRead = status === 'Read';
  }
  if (type && type !== 'Alert Type') {
    query.notificationType = type;
  }

  // Find notifications
  let notifications = await Notification.find(query)
    .populate('senderId', 'fullName email profilePhoto')
    .sort({ createdAt: -1 });

  // Apply client search filter if present (by message or sender name)
  if (search) {
    const lowSearch = search.toLowerCase();
    notifications = notifications.filter(n => {
      const msgMatch = n.message.toLowerCase().includes(lowSearch);
      const typeMatch = n.notificationType.toLowerCase().includes(lowSearch);
      const senderMatch = n.senderId && n.senderId.fullName 
        ? n.senderId.fullName.toLowerCase().includes(lowSearch) 
        : false;
      return msgMatch || typeMatch || senderMatch;
    });
  }

  // Apply memory pagination after memory filtering
  const total = notifications.length;
  const startIndex = (page - 1) * limit;
  const paginated = notifications.slice(startIndex, startIndex + Number(limit));

  sendSuccess(res, 'Notifications fetched successfully', {
    notifications: paginated,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get unread count & analytics cards count
 * @route   GET /api/admin/notifications/unread-count
 * @access  Private/Admin
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const query = { receiverRole: 'admin', isDeleted: false };
  
  // Total unread
  const unreadTotal = await Notification.countDocuments({ ...query, isRead: false });
  
  // Analytical Cards breakdown counts (all time active/undeleted alerts by type)
  const newApps = await Notification.countDocuments({ ...query, notificationType: 'NewLoanRequest' });
  const overdueAlerts = await Notification.countDocuments({ ...query, notificationType: 'OverdueAlert' });
  const payments = await Notification.countDocuments({ ...query, notificationType: 'PaymentVerification' });
  const approvals = await Notification.countDocuments({ ...query, notificationType: 'ReviewAssigned' });

  sendSuccess(res, 'Notification counts fetched', {
    unreadCount: unreadTotal,
    analytics: {
      newApplications: newApps,
      overdueAlerts: overdueAlerts,
      paymentNotifications: payments,
      approvalAlerts: approvals
    }
  });
});

/**
 * @desc    Get single notification
 * @route   GET /api/admin/notifications/:id
 * @access  Private/Admin
 */
const getNotificationById = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, isDeleted: false })
    .populate('senderId', 'fullName role profilePhoto');

  if (!notification) {
    return sendError(res, 'Notification not found or retracted', 404);
  }

  sendSuccess(res, 'Single notification retrieved', notification);
});

/**
 * @desc    Mark single notification as read
 * @route   PATCH /api/admin/notifications/:id/read
 * @access  Private/Admin
 */
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { new: true }
  ).populate('senderId', 'fullName role profilePhoto');

  if (!notification) {
    return sendError(res, 'Notification not found', 404);
  }

  // Emit event
  try {
    const io = getIO();
    io.emit('notification:read', { id: notification._id, status: 'Read' });
  } catch (err) {}

  sendSuccess(res, 'Notification marked as read', notification);
});

/**
 * @desc    Mark all as read
 * @route   PATCH /api/admin/notifications/read-all
 * @access  Private/Admin
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverRole: 'admin', isDeleted: false, isRead: false },
    { isRead: true }
  );

  // Broadcast to sockets
  try {
    const io = getIO();
    io.emit('notification:read', { scope: 'all' });
  } catch (err) {}

  sendSuccess(res, 'All messages flagged as read successfully');
});

/**
 * @desc    Soft delete single notification
 * @route   DELETE /api/admin/notifications/:id
 * @access  Private/Admin
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { isDeleted: true },
    { new: true }
  );

  if (!notification) {
    return sendError(res, 'Notification not found', 404);
  }

  // Broadcast
  try {
    const io = getIO();
    io.emit('notification:delete', { id: notification._id });
  } catch (err) {}

  sendSuccess(res, 'Alert soft deleted', { id: notification._id });
});

/**
 * @desc    Soft delete all notifications (Clear Inbox)
 * @route   DELETE /api/admin/notifications/clear-all
 * @access  Private/Admin
 */
const clearAllNotifications = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverRole: 'admin', isDeleted: false },
    { isDeleted: true }
  );

  // Broadcast
  try {
    const io = getIO();
    io.emit('notification:delete', { scope: 'all' });
  } catch (err) {}

  sendSuccess(res, 'Entire notification registry archived successfully');
});

module.exports = {
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications
};

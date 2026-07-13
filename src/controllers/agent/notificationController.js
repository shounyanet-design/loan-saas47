const asyncHandler = require('express-async-handler');
const Notification = require('../../models/Notification');
const Borrower = require('../../models/Borrower');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');

/**
 * @desc    Get Agent notifications with analytics and filters
 * @route   GET /api/agent/notifications
 * @access  Private/Agent
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { type, status, priority, search, page = 1, limit = 10 } = req.query;
  
  const query = {
    receiverId: req.user._id,
    isDeleted: false
  };

  if (type) query.type = type;
  if (status) query.status = status;
  if (priority) query.priority = priority;
  
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { message: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;
  
  const notifications = await Notification.find(query)
    .populate('borrowerId', 'fullName profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Notification.countDocuments(query);

  // Analytics logic
  const stats = await Notification.aggregate([
    { $match: { receiverId: req.user._id, isDeleted: false } },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 }
      }
    }
  ]);

  const unreadCount = await Notification.countDocuments({
    receiverId: req.user._id,
    status: 'UNREAD',
    isDeleted: false
  });

  const analytics = {
    borrowerAlerts: stats.find(s => s._id === 'BORROWER_ALERT')?.count || 0,
    dueReminders: stats.find(s => s._id === 'DUE_REMINDER')?.count || 0,
    loanApprovals: stats.find(s => s._id === 'LOAN_APPROVAL')?.count || 0,
    messagesCount: stats.find(s => s._id === 'AdminMessage' || s._id === 'NewMessage')?.count || 0,
    unreadCount
  };

  // Recent Activity
  const recentActivity = await Notification.find({ receiverId: req.user._id, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(5);

  sendSuccess(res, 'Notifications fetched successfully', {
    notifications,
    analytics,
    recentActivity,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get single notification details
 * @route   GET /api/agent/notifications/:id
 * @access  Private/Agent
 */
const getNotificationById = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    receiverId: req.user._id,
    isDeleted: false
  }).populate('borrowerId');

  if (!notification) {
    return sendError(res, 'Notification not found or unauthorized', 403);
  }

  sendSuccess(res, 'Notification details fetched', notification);
});

/**
 * @desc    Mark notification as read
 * @route   PATCH /api/agent/notifications/:id/read
 * @access  Private/Agent
 */
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, receiverId: req.user._id },
    { status: 'READ', isRead: true, readAt: new Date() },
    { new: true }
  );

  if (!notification) {
    return sendError(res, 'Notification not found', 404);
  }

  // Real-time update
  const io = getIO();
  if (io) {
    const unreadCount = await Notification.countDocuments({
      receiverId: req.user._id,
      status: 'UNREAD',
      isDeleted: false
    });
    io.to(req.user._id.toString()).emit('notification:read', { id: notification._id });
    io.to(req.user._id.toString()).emit('notification:count', { unreadCount });
  }

  sendSuccess(res, 'Notification marked as read', notification);
});

/**
 * @desc    Mark all notifications as read
 * @route   PATCH /api/agent/notifications/read-all
 * @access  Private/Agent
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverId: req.user._id, status: 'UNREAD' },
    { status: 'READ', isRead: true, readAt: new Date() }
  );

  const io = getIO();
  if (io) {
    io.to(req.user._id.toString()).emit('notification:count', { unreadCount: 0 });
  }

  sendSuccess(res, 'All notifications marked as read');
});

/**
 * @desc    Delete notification (Soft delete)
 * @route   DELETE /api/agent/notifications/:id
 * @access  Private/Agent
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, receiverId: req.user._id },
    { isDeleted: true },
    { new: true }
  );

  if (!notification) {
    return sendError(res, 'Notification not found', 404);
  }

  const io = getIO();
  if (io) {
    const unreadCount = await Notification.countDocuments({
      receiverId: req.user._id,
      status: 'UNREAD',
      isDeleted: false
    });
    io.to(req.user._id.toString()).emit('notification:delete', { id: notification._id });
    io.to(req.user._id.toString()).emit('notification:count', { unreadCount });
  }

  sendSuccess(res, 'Notification deleted successfully');
});

/**
 * @desc    Clear all notifications
 * @route   DELETE /api/agent/notifications/clear-all
 * @access  Private/Agent
 */
const clearAllNotifications = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverId: req.user._id },
    { isDeleted: true }
  );

  const io = getIO();
  if (io) {
    io.to(req.user._id.toString()).emit('notification:count', { unreadCount: 0 });
  }

  sendSuccess(res, 'All notifications cleared');
});

/**
 * @desc    Send follow-up reminder
 * @route   POST /api/agent/notifications/send-reminder
 * @access  Private/Agent
 */
const sendFollowUpReminder = asyncHandler(async (req, res) => {
  const { borrowerId, reminderType, message } = req.body;

  if (!borrowerId || !reminderType) {
    return sendError(res, 'Borrower ID and Reminder Type are required', 400);
  }

  const borrower = await Borrower.findById(borrowerId);
  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  // Simulate external gateway call (SMS/WhatsApp/Email)
  // In a real system, you'd call a service here.

  // Create a log notification for the agent to track that they sent a reminder
  await Notification.create({
    receiverId: req.user._id,
    receiverRole: 'agent',
    borrowerId,
    type: 'PAYMENT_UPDATE',
    title: `Reminder Sent (${reminderType})`,
    message: `You sent a ${reminderType} reminder to ${borrower.fullName}: "${message || 'Default reminder'}"`,
    priority: 'LOW',
    status: 'READ',
    isRead: true
  });
  
  sendSuccess(res, `Reminder successfully dispatched via ${reminderType}`);
});


/**
 * @desc    Save follow-up note
 * @route   POST /api/agent/notifications/follow-up
 * @access  Private/Agent
 */
const saveFollowUpNote = asyncHandler(async (req, res) => {
  const { borrowerId, notes, nextFollowUpDate } = req.body;

  if (!borrowerId || !notes) {
    return sendError(res, 'Borrower ID and Notes are required', 400);
  }

  const borrower = await Borrower.findById(borrowerId);
  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  // Update borrower or create a separate activity log
  // Here we assume borrower model has these fields or we create a notification for it
  
  await Notification.create({
    receiverId: req.user._id,
    receiverRole: 'agent',
    borrowerId,
    type: 'FOLLOWUP_REMINDER',
    title: 'Follow-Up Recorded',
    message: `Follow-up notes for ${borrower.fullName}: ${notes}. Next follow-up: ${nextFollowUpDate || 'N/A'}`,
    priority: 'NORMAL',
    status: 'READ',
    isRead: true,
    metadata: { notes, nextFollowUpDate }
  });

  sendSuccess(res, 'Follow-up note saved successfully');
});

module.exports = {
  getNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  sendFollowUpReminder,
  saveFollowUpNote
};

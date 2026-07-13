const Notification = require('../../models/Notification');
const { getIO } = require('../../socket/socketServer');

/**
 * @desc    Get staff notifications
 * @route   GET /api/staff/notifications
 * @access  Private (Staff)
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, isRead, type } = req.query;
    
    const query = {
      receiverId: req.user.id,
      isDeleted: false
    };

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    if (type) {
      query.notificationType = type;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      data: notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get unread notifications count
 * @route   GET /api/staff/notifications/unread-count
 * @access  Private (Staff)
 */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      receiverId: req.user.id,
      isRead: false,
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark single notification as read
 * @route   PUT /api/staff/notifications/:id/read
 * @access  Private (Staff)
 */
exports.markRead = async (req, res, next) => {
  try {
    let notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    // Make sure notification belongs to user
    if (notification.receiverId.toString() !== req.user.id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    notification.isRead = true;
    await notification.save();

    // Emit socket event for unread count update
    const unreadCount = await Notification.countDocuments({
      receiverId: req.user.id,
      isRead: false,
      isDeleted: false
    });

    const io = getIO();
    io.to(req.user.id.toString()).emit('unread:updated', { unreadCount });
    io.to(req.user.id.toString()).emit('notification:updated', notification);

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/staff/notifications/read-all
 * @access  Private (Staff)
 */
exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { receiverId: req.user.id, isRead: false },
      { isRead: true }
    );

    const io = getIO();
    io.to(req.user.id.toString()).emit('unread:updated', { unreadCount: 0 });

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete notification (soft delete)
 * @route   DELETE /api/staff/notifications/:id
 * @access  Private (Staff)
 */
exports.deleteNotification = async (req, res, next) => {
  try {
    let notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (notification.receiverId.toString() !== req.user.id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    notification.isDeleted = true;
    await notification.save();

    // Emit socket event for unread count update if it was unread
    if (!notification.isRead) {
      const unreadCount = await Notification.countDocuments({
        receiverId: req.user.id,
        isRead: false,
        isDeleted: false
      });
      const io = getIO();
      io.to(req.user.id.toString()).emit('unread:updated', { unreadCount });
    }

    const io = getIO();
    io.to(req.user.id.toString()).emit('notification:deleted', req.params.id);

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear all notifications (soft delete)
 * @route   DELETE /api/staff/notifications/clear-all
 * @access  Private (Staff)
 */
exports.clearAllNotifications = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { receiverId: req.user.id },
      { isDeleted: true }
    );

    const io = getIO();
    io.to(req.user.id.toString()).emit('unread:updated', { unreadCount: 0 });

    res.status(200).json({
      success: true,
      message: 'All notifications cleared'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper function to create notification and emit socket event
 */
exports.createNotification = async (data) => {
  try {
    const notification = await Notification.create(data);
    
    const unreadCount = await Notification.countDocuments({
      receiverId: data.receiverId,
      isRead: false,
      isDeleted: false
    });

    const io = getIO();
    // Emit to a room named after the receiverId
    io.to(data.receiverId.toString()).emit('notification:new', notification);
    io.to(data.receiverId.toString()).emit('unread:updated', { unreadCount });

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

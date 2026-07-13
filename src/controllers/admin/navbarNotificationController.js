const Notification = require('../../models/Notification');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');

/**
 * @desc    Get latest 10 notifications for Navbar
 * @route   GET /api/admin/navbar-notifications
 * @access  Private/Admin
 */
const getNavbarNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ 
    receiverId: req.user._id,
    isDeleted: false 
  })
  .populate('senderId', 'fullName profilePhoto')
  .sort({ createdAt: -1 })
  .limit(10);

  sendSuccess(res, 'Latest 10 navbar notifications fetched successfully', { notifications });
});

/**
 * @desc    Get Navbar overall unread count
 * @route   GET /api/admin/navbar-notifications/unread-count
 * @access  Private/Admin
 */
const getNavbarUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({ 
    receiverId: req.user._id,
    isDeleted: false,
    isRead: false
  });

  sendSuccess(res, 'Unread count fetched successfully', { unreadCount });
});

/**
 * @desc    Mark single navbar notification as read
 * @route   PATCH /api/admin/navbar-notifications/:id/read
 * @access  Private/Admin
 */
const markNavbarNotificationAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    return sendError(res, 'Notification not found', 404);
  }

  // Emit Socket updates
  try {
    const io = getIO();
    io.to(req.user._id.toString()).emit('notification:read', { id: notification._id });
    
    // Also emit unread count update
    const unreadCount = await Notification.countDocuments({ 
      receiverId: req.user._id,
      isDeleted: false,
      isRead: false
    });
    io.to(req.user._id.toString()).emit('unread:updated', { unreadCount });
  } catch (err) {}

  sendSuccess(res, 'Navbar notification marked as read', notification);
});

/**
 * @desc    Mark all navbar notifications as read
 * @route   PATCH /api/admin/navbar-notifications/read-all
 * @access  Private/Admin
 */
const markAllNavbarNotificationsAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverId: req.user._id, isDeleted: false, isRead: false },
    { isRead: true }
  );

  // Emit Socket updates
  try {
    const io = getIO();
    io.to(req.user._id.toString()).emit('notification:read', { scope: 'all' });
    io.to(req.user._id.toString()).emit('unread:updated', { unreadCount: 0 });
  } catch (err) {}

  sendSuccess(res, 'All navbar notifications marked as read successfully');
});

module.exports = {
  getNavbarNotifications,
  getNavbarUnreadCount,
  markNavbarNotificationAsRead,
  markAllNavbarNotificationsAsRead
};

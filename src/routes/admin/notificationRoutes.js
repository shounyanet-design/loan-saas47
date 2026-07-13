const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications
} = require('../../controllers/admin/notificationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// Protect all routes (Admin Only)
router.use(protect);
router.use(authorize('admin'));

// Specific routes first
router.get('/unread-count', getUnreadCount);
router.patch('/read-all', markAllAsRead);
router.delete('/clear-all', clearAllNotifications);

// Individual resource operations
router.get('/', getNotifications);
router.get('/:id', getNotificationById);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;

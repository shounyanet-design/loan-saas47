const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearAllNotifications
} = require('../../controllers/staff/notificationController');
const { protect } = require('../../middlewares/authMiddleware');

// All routes are protected
router.use(protect);

router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllRead);
router.delete('/clear-all', clearAllNotifications);

router.get('/', getNotifications);
router.put('/:id/read', markRead);
router.delete('/:id', deleteNotification);

module.exports = router;

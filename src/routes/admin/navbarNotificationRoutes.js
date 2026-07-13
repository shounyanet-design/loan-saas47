const express = require('express');
const router = express.Router();
const {
  getNavbarNotifications,
  getNavbarUnreadCount,
  markNavbarNotificationAsRead,
  markAllNavbarNotificationsAsRead
} = require('../../controllers/admin/navbarNotificationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// Protect all routes below to Admin users only
router.use(protect);
router.use(authorize('admin'));

router.get('/', getNavbarNotifications);
router.get('/unread-count', getNavbarUnreadCount);
router.patch('/:id/read', markNavbarNotificationAsRead);
router.patch('/read-all', markAllNavbarNotificationsAsRead);

module.exports = router;

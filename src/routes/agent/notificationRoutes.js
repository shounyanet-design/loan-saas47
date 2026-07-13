const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  sendFollowUpReminder,
  saveFollowUpNote
} = require('../../controllers/agent/notificationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and restricted to agents
router.use(protect);
router.use(authorize('agent'));

router.get('/', getNotifications);
router.get('/:id', getNotificationById);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/clear-all', clearAllNotifications);
router.delete('/:id', deleteNotification);
router.post('/send-reminder', sendFollowUpReminder);
router.post('/follow-up', saveFollowUpNote);

module.exports = router;

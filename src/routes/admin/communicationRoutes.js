const express = require('express');
const router = express.Router();
const {
  getAllConversations,
  getSingleConversation,
  sendMessage,
  broadcastMessage,
  markMessagesRead,
  searchConversations,
  getUnreadCounts,
  deleteMessage
} = require('../../controllers/admin/communicationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('admin'));

router.get('/unread', getUnreadCounts);
router.get('/search', searchConversations);
router.get('/', getAllConversations);
router.post('/send', sendMessage);
router.post('/broadcast', broadcastMessage);
router.get('/:id', getSingleConversation);
router.put('/read/:conversationId', markMessagesRead);
router.delete('/message/:id', deleteMessage);

module.exports = router;

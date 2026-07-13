const express = require('express');
const router = express.Router();
const { 
  getConversations,
  getConversation,
  sendMessage,
  createReminder,
  markAsRead,
  searchConversations
} = require('../../controllers/agent/communicationController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes protected and restricted to Agents
router.use(protect);
router.use(authorize('agent'));

router.get('/', getConversations);
router.get('/search', searchConversations);
router.get('/:id', getConversation);
router.post('/send', sendMessage);
router.post('/reminder', createReminder);
router.put('/read/:conversationId', markAsRead);

module.exports = router;

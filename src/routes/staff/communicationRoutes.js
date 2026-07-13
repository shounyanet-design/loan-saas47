const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const {
  getStaffConversations,
  getSingleConversation,
  createNewConversation,
  sendMessage,
  markConversationRead,
  deleteMessage,
  getOnlineUsers
} = require('../../controllers/staff/communicationController');

// All communication logic strictly restricted to staff tokens
router.use(protect);
router.use(authorize('staff'));

// Root Listing Endpoint
router.get('/', getStaffConversations);

// Utility for directory structure
router.get('/online-users', getOnlineUsers);

// Conversation instantiation endpoint
router.post('/create', createNewConversation);

// Retrieval and update per-thread endpoints
router.get('/:conversationId', getSingleConversation);
router.post('/:conversationId/send', sendMessage);
router.put('/:conversationId/read', markConversationRead);

// Message deletion worker
router.delete('/message/:messageId', deleteMessage);

module.exports = router;

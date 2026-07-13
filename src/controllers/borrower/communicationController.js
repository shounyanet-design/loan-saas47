const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const Notification = require('../../models/Notification');
const LoanApplication = require('../../models/LoanApplication');
const LoanAssignment = require('../../models/LoanAssignment');
const Borrower = require('../../models/Borrower');
const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');
const imagekit = require('../../config/imagekit');
const { createNotification } = require('../../utils/notificationHelper');

/**
 * @desc    Get all conversations for borrower
 * @route   GET /api/borrower/conversations
 */
exports.getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Only return direct 1:1 conversations (2 participants) to avoid group conversations
  // created when staff is added to the borrower-admin thread
  const conversations = await Conversation.find({
    participants: userId,
    isActive: true,
    isDeleted: false,
    $expr: { $eq: [{ $size: '$participants' }, 2] }
  })
    .populate('participants', 'fullName role profilePhoto email')
    .sort({ updatedAt: -1 });

  // Build formatted list and deduplicate by chat partner
  // (conversations are sorted by updatedAt desc, so the first one per partner is the most recent)
  const seenPartners = new Set();
  const formatted = [];

  for (const conv of conversations) {
    const convObj = conv.toObject();
    convObj.chatPartner = conv.participants.find(p => p._id.toString() !== userId.toString());
    const partnerId = convObj.chatPartner?._id?.toString();
    if (partnerId && seenPartners.has(partnerId)) continue; // skip older duplicate
    if (partnerId) seenPartners.add(partnerId);
    formatted.push(convObj);
  }

  sendSuccess(res, 'Conversations retrieved', formatted);
});

/**
 * @desc    Get messages for a specific conversation
 * @route   GET /api/borrower/conversations/:id/messages
 */
exports.getMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  // Check if user is participant
  const conversation = await Conversation.findOne({ _id: id, participants: userId });
  if (!conversation) {
    return sendError(res, 'Unauthorized or conversation not found', 403);
  }

  const messages = await Message.find({ conversationId: id, isDeleted: false })
    .populate('senderId', 'fullName role profilePhoto')
    .sort({ createdAt: 1 });

  // Mark all messages as read by this user
  await Message.updateMany(
    { conversationId: id, senderId: { $ne: userId }, isRead: false },
    { $set: { isRead: true }, $addToSet: { readBy: userId } }
  );

  // Reset unread count for this user in conversation
  const unreadField = `unreadCounts.${userId}`;
  await Conversation.findByIdAndUpdate(id, { $set: { [unreadField]: 0 } });

  // Emit socket event for read status
  const io = getIO();
  io.to(id).emit('messages-read', { conversationId: id, userId });

  sendSuccess(res, 'Messages retrieved', messages);
});

/**
 * @desc    Send a message
 * @route   POST /api/borrower/messages/send
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, message, messageType } = req.body;
  const userId = req.user._id;
  const userRole = req.user.role;

  let attachment = null;
  let attachmentName = null;

  // Check if conversation exists and user is participant
  let conversation = await Conversation.findOne({ _id: conversationId, participants: userId });
  if (!conversation) {
    return sendError(res, 'Unauthorized or conversation not found', 403);
  }

  // Handle file upload if present
  if (req.file) {
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `chat_${Date.now()}_${req.file.originalname}`,
      folder: '/lms/chat-attachments'
    });
    attachment = uploadResponse.url;
    attachmentName = req.file.originalname;
  }

  // Create message
  const otherParticipant = conversation.participants.find(p => p.toString() !== userId.toString());
  
  const newMessage = await Message.create({
    conversationId,
    senderId: userId,
    senderRole: userRole,
    receiverId: otherParticipant,
    message,
    messageText: message,
    messageType: messageType || (attachment ? 'file' : 'text'),
    attachment,
    attachmentName,
    attachments: attachment ? [attachment] : []
  });

  // Update conversation last message
  const updateData = {
    lastMessage: message || (attachment ? 'Sent an attachment' : ''),
    lastMessageAt: new Date(),
    lastMessageTime: new Date(),
    updatedAt: new Date()
  };

  // Increment unread counts for other participants
  conversation.participants.forEach(participantId => {
    if (participantId.toString() !== userId.toString()) {
      const field = `unreadCounts.${participantId}`;
      updateData[field] = (conversation.unreadCounts.get(participantId.toString()) || 0) + 1;
    }
  });

  await Conversation.findByIdAndUpdate(conversationId, { $set: updateData });

  // Populate sender info for real-time update
  const populatedMessage = await Message.findById(newMessage._id)
    .populate('senderId', 'fullName role profilePhoto');

  // Emit socket events
  const io = getIO();
  // 1. Send to the conversation room (Multiple events for broad compatibility)
  io.to(conversationId).emit('message-received', populatedMessage);
  io.to(conversationId).emit('message:received', populatedMessage);
  io.to(conversationId).emit('receiveMessage', populatedMessage);
  io.to(conversationId).emit('receive_message', populatedMessage);

  // 2. Send notifications to other participants
  conversation.participants.forEach(async (participantId) => {
    if (participantId.toString() !== userId.toString()) {
      // Notification popup
      io.to(participantId.toString()).emit('message-notification', {
        conversationId,
        message: populatedMessage,
        senderName: req.user.fullName
      });

      // Update sidebar
      io.to(participantId.toString()).emit('conversation-updated', {
        conversationId,
        lastMessage: updateData.lastMessage,
        lastMessageAt: updateData.lastMessageAt,
        unreadCount: updateData[`unreadCounts.${participantId}`]
      });

      // Create persistence notification using helper for real-time broadcast
      try {
        const receiverUser = await User.findById(participantId);
        if (receiverUser) {
          await createNotification({
            receiverId: participantId,
            receiverRole: receiverUser.role,
            senderId: userId,
            senderRole: userRole,
            type: 'NewMessage',
            notificationType: 'NewMessage',
            title: `New message from ${req.user.fullName}`,
            message: message || (attachment ? 'Sent an attachment' : ''),
            relatedConversation: conversationId,
            priority: 'normal'
          });
        }
      } catch (notifError) {
        console.error('Failed to create notification:', notifError);
      }

      io.to(participantId.toString()).emit('new-notification', {
        title: `New message from ${req.user.fullName}`,
        message: message || 'Sent an attachment',
        conversationId
      });
    }
  });

  sendSuccess(res, 'Message sent', populatedMessage);
});

/**
 * @desc    Mark messages as read
 * @route   PATCH /api/borrower/messages/read
 */
exports.markRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.body;
  const userId = req.user._id;

  await Message.updateMany(
    { conversationId, senderId: { $ne: userId }, isRead: false },
    { $set: { isRead: true }, $addToSet: { readBy: userId } }
  );

  const unreadField = `unreadCounts.${userId}`;
  await Conversation.findByIdAndUpdate(conversationId, { $set: { [unreadField]: 0 } });

  const io = getIO();
  io.to(conversationId).emit('messages-read', { conversationId, userId });

  sendSuccess(res, 'Messages marked as read');
});

/**
 * @desc    Get borrower notifications
 * @route   GET /api/borrower/notifications
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const notifications = await Notification.find({ receiverId: userId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(50);

  sendSuccess(res, 'Notifications retrieved', notifications);
});

/**
 * @desc    Mark notification as read
 * @route   PATCH /api/borrower/notifications/:id/read
 */
exports.markNotificationRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const notification = await Notification.findByIdAndUpdate(id, {
    isRead: true,
    status: 'READ',
    readAt: new Date()
  }, { new: true });

  sendSuccess(res, 'Notification marked as read', notification);
});

/**
 * @desc    Get authorized participants for borrower
 *          Admin (always) + Staff/Agent assigned to borrower's loan applications via LoanAssignment
 * @route   GET /api/borrower/communications/participants
 */
exports.getParticipants = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const participantMap = new Map();

  // 1. Always include admins — use $ne so documents without the field are also matched
  const admins = await User.find({ role: 'admin', isActive: { $ne: false }, isDeleted: { $ne: true } })
    .select('fullName role email profilePhoto');
  admins.forEach(a => participantMap.set(a._id.toString(), a.toObject()));

  // 2. Find all loan applications submitted by this borrower
  const applications = await LoanApplication.find({
    borrowerId: userId,
    status: { $nin: ['Draft'] }
  }).select('_id assignedReviewer');

  if (applications.length > 0) {
    const appIds = applications.map(a => a._id);

    // 3. Get staff + agent IDs from LoanAssignment records
    const assignments = await LoanAssignment.find({
      loanApplicationId: { $in: appIds }
    }).populate('assignedAgentId assignedStaffId', 'fullName role email profilePhoto isActive isDeleted');

    assignments.forEach(a => {
      // Agent: show if assigned to borrower's application
      if (a.assignedAgentId &&
        a.assignedAgentId.isActive !== false && !a.assignedAgentId.isDeleted) {
        participantMap.set(a.assignedAgentId._id.toString(), a.assignedAgentId.toObject());
      }
      // Staff: include regardless of assignment type (admin always explicitly assigns staff)
      if (a.assignedStaffId &&
        a.assignedStaffId.isActive !== false && !a.assignedStaffId.isDeleted) {
        participantMap.set(a.assignedStaffId._id.toString(), a.assignedStaffId.toObject());
      }
    });

    // 4. Also include directly assigned reviewer from LoanApplication
    const reviewerIds = applications.filter(a => a.assignedReviewer).map(a => a.assignedReviewer);
    if (reviewerIds.length > 0) {
      const reviewers = await User.find({
        _id: { $in: reviewerIds },
        isActive: { $ne: false },
        isDeleted: { $ne: true }
      }).select('fullName role email profilePhoto');
      reviewers.forEach(r => participantMap.set(r._id.toString(), r.toObject()));
    }
  }

  // 5. Fallback: Borrower profile's legacy assignedAgent/assignedStaff fields
  const borrower = await Borrower.findOne({ userId })
    .populate('assignedAgent assignedStaff', 'fullName role email profilePhoto');
  if (borrower) {
    if (borrower.assignedAgent) participantMap.set(borrower.assignedAgent._id.toString(), borrower.assignedAgent.toObject());
    if (borrower.assignedStaff) participantMap.set(borrower.assignedStaff._id.toString(), borrower.assignedStaff.toObject());
  }

  sendSuccess(res, 'Participants retrieved', Array.from(participantMap.values()));
});

/**
 * @desc    Start or get conversation with a participant
 *          Only allows conversations with: admin (always) | staff/agent assigned to borrower's loans
 * @route   POST /api/borrower/communications/conversations/start
 */
exports.startConversation = asyncHandler(async (req, res) => {
  const { participantId, loanId, applicationId } = req.body;
  const userId = req.user._id;

  // 1. Verify participant exists and is active
  const participant = await User.findById(participantId).select('role isActive isDeleted');
  if (!participant || participant.isDeleted || participant.isActive === false) {
    return sendError(res, 'Participant not found or inactive', 404);
  }

  // 2. Authorization: admin is always reachable; staff/agent must be assigned to this borrower
  if (participant.role !== 'admin') {
    const apps = await LoanApplication.find({
      borrowerId: userId,
      status: { $nin: ['Draft'] }
    }).select('_id assignedReviewer');

    const appIds = apps.map(a => a._id);

    const isInAssignment = await LoanAssignment.exists({
      loanApplicationId: { $in: appIds },
      $or: [{ assignedAgentId: participantId }, { assignedStaffId: participantId }]
    });

    const isDirectReviewer = apps.some(a => a.assignedReviewer?.toString() === participantId.toString());

    const borrowerProfile = await Borrower.findOne({ userId }).select('assignedAgent assignedStaff');
    const isInProfile = borrowerProfile && (
      borrowerProfile.assignedAgent?.toString() === participantId.toString() ||
      borrowerProfile.assignedStaff?.toString() === participantId.toString()
    );

    if (!isInAssignment && !isDirectReviewer && !isInProfile) {
      return sendError(res, 'You are not authorized to contact this user', 403);
    }
  }

  // 3. Reuse existing DIRECT (2-person) conversation if one exists
  // Using $size: 2 prevents accidentally finding the group conversation where staff
  // was added to the borrower-admin thread via $addToSet during loan assignment
  let conversation = await Conversation.findOne({
    participants: { $all: [userId, participantId] },
    $expr: { $eq: [{ $size: '$participants' }, 2] },
    isActive: true,
    isDeleted: false
  });

  if (!conversation) {
    conversation = await Conversation.create({
      participants: [userId, participantId],
      loanId,
      applicationId,
      isActive: true,
      unreadCounts: { [userId]: 0, [participantId]: 0 }
    });
  }

  const populatedConv = await Conversation.findById(conversation._id)
    .populate('participants', 'fullName role profilePhoto');

  const convObj = populatedConv.toObject();
  convObj.chatPartner = populatedConv.participants.find(p => p._id.toString() !== userId.toString());

  sendSuccess(res, 'Conversation started', convObj);
});

/**
 * @desc    Delete a single notification
 * @route   DELETE /api/borrower/communications/notifications/:id
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, receiverId: req.user._id },
    { isDeleted: true },
    { new: true }
  );

  if (!notification) {
    return sendError(res, 'Notification not found or access denied', 404);
  }

  sendSuccess(res, 'Notification deleted successfully');
});

/**
 * @desc    Clear all notifications for the borrower
 * @route   DELETE /api/borrower/communications/notifications/clear-all
 */
exports.clearNotifications = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverId: req.user._id, isDeleted: false },
    { isDeleted: true }
  );

  sendSuccess(res, 'All notifications cleared successfully');
});

/**
 * @desc    Mark all notifications as read for the borrower
 * @route   PATCH /api/borrower/communications/notifications/read-all
 */
exports.markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { receiverId: req.user._id, isRead: false, isDeleted: false },
    { isRead: true, status: 'READ' }
  );

  sendSuccess(res, 'All notifications marked as read');
});

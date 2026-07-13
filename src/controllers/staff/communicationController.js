const mongoose = require('mongoose');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');
const { createNotification } = require('../../utils/notificationHelper');

/**
 * @desc    Get Staff Conversations List (Filtered & Searched)
 * @route   GET /api/staff/communications
 */
const getStaffConversations = asyncHandler(async (req, res) => {
  const { search, conversationType, unreadOnly } = req.query;
  const currentUserId = req.user._id.toString();

  const query = {
    participants: req.user._id,
    isDeleted: false
  };

  if (conversationType && conversationType !== 'All') {
    query.conversationType = conversationType;
  }

  // Retrieve conversations with populated details
  let conversations = await Conversation.find(query)
    .populate('participants', 'fullName role profilePhoto')
    .sort({ updatedAt: -1 });

  // Formatter to map variables specifically for frontend expectations
  let formattedList = conversations.map(c => {
    // Identify the other party
    const otherParty = c.participants.find(p => p._id.toString() !== currentUserId) || req.user;

    const unread = c.unreadCounts && typeof c.unreadCounts.get === 'function'
      ? (c.unreadCounts.get(currentUserId) || 0)
      : (c.unreadCounts && c.unreadCounts[currentUserId] || 0);

    return {
      conversationId: c._id,
      participantId: otherParty._id,
      participantName: otherParty.fullName,
      participantRole: otherParty.role,
      participantPhoto: otherParty.profilePhoto || 'no-photo.jpg',
      lastMessage: c.lastMessage || 'No messages yet.',
      lastMessageTime: c.lastMessageAt || c.lastMessageTime || c.updatedAt,
      unreadCount: unread,
      conversationType: c.conversationType,
      onlineStatus: 'offline' // Hydrated live by Socket.io at runtime
    };
  });

  // Apply text keyword search across peer user name & last messages
  if (search) {
    const keyword = search.toLowerCase();
    formattedList = formattedList.filter(item =>
      item.participantName.toLowerCase().includes(keyword) ||
      item.lastMessage.toLowerCase().includes(keyword)
    );
  }

  // Apply filter for unread-only threads
  if (unreadOnly === 'true') {
    formattedList = formattedList.filter(item => item.unreadCount > 0);
  }

  sendSuccess(res, 'Staff conversations streamed successfully', formattedList);
});

/**
 * @desc    Get Single Conversation & All Messages
 * @route   GET /api/staff/communications/:conversationId
 */
const getSingleConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const currentUserId = req.user._id.toString();

  // Resolve deep population
  const conversation = await Conversation.findById(conversationId)
    .populate('participants', 'fullName role profilePhoto');

  if (!conversation) {
    return sendError(res, 'Requested conversation thread not found', 404);
  }

  // Confirm current user authorization within participants array
  const isParticipant = conversation.participants.some(p => p._id.toString() === currentUserId);
  if (!isParticipant) {
    return sendError(res, 'Not authorized to view this conversation thread', 403);
  }

  // Stream message records
  const messages = await Message.find({ conversationId, isDeleted: false })
    .populate('senderId', 'fullName role profilePhoto')
    .sort({ createdAt: 1 });

  // Formatted payloads
  const formattedMessages = messages.map(m => ({
    messageId: m._id,
    senderId: m.senderId?._id,
    senderName: m.senderId?.fullName || 'System User',
    senderRole: m.senderRole || m.senderId?.role,
    senderPhoto: m.senderId?.profilePhoto || 'no-photo.jpg',
    message: m.message || m.messageText || '',
    attachments: m.attachments || (m.attachmentUrl ? [m.attachmentUrl] : []),
    delivered: m.delivered || m.isDelivered,
    readBy: m.readBy || [],
    createdAt: m.createdAt
  }));

  sendSuccess(res, 'Conversation package hydration complete', {
    conversation: {
      conversationId: conversation._id,
      conversationType: conversation.conversationType,
      participants: conversation.participants.map(p => ({
        userId: p._id,
        name: p.fullName,
        role: p.role,
        photo: p.profilePhoto || 'no-photo.jpg'
      }))
    },
    messages: formattedMessages
  });
});

/**
 * @desc    Create / Initialize a new conversation thread
 * @route   POST /api/staff/communications/create
 */
const createNewConversation = asyncHandler(async (req, res) => {
  const { targetUserId, targetRole, initialMessage } = req.body;
  const currentUserId = req.user._id.toString();

  if (!targetUserId) {
    return sendError(res, 'Target recipient identification is required', 400);
  }

  // Ensure recipient exists
  const recipient = await User.findById(targetUserId);
  if (!recipient) {
    return sendError(res, 'Target recipient user not found', 404);
  }

  // Map specific conversationType Enum expected by prompt: Borrower, Agent, Admin, Internal Staff
  let resolvedType = 'Internal Staff';
  const normalizedRole = (targetRole || recipient.role).toLowerCase();
  if (normalizedRole === 'borrower') resolvedType = 'Borrower';
  else if (normalizedRole === 'agent') resolvedType = 'Agent';
  else if (normalizedRole === 'admin') resolvedType = 'Admin';

  // Locate existing direct conversation to prevent duplicates
  let conversation = await Conversation.findOne({
    participants: { $all: [req.user._id, recipient._id] },
    isBroadcast: false,
    isDeleted: false
  });

  let isNew = false;
  if (!conversation) {
    isNew = true;
    conversation = await Conversation.create({
      participants: [req.user._id, recipient._id],
      participantRoles: [req.user.role, recipient.role],
      conversationType: resolvedType,
      participantType: 'direct',
      createdBy: req.user._id,
      unreadCounts: { [currentUserId]: 0, [recipient._id.toString()]: 0 }
    });
  }

  // Record initial message payload if defined
  let savedMsg = null;
  if (initialMessage && initialMessage.trim().length > 0) {
    savedMsg = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      senderRole: req.user.role,
      receiverId: recipient._id,
      receiverRole: recipient.role,
      message: initialMessage,
      messageText: initialMessage,
      delivered: true,
      isDelivered: true
    });

    conversation.lastMessage = initialMessage;
    conversation.lastMessageAt = new Date();
    conversation.lastMessageTime = new Date();

    // Increment unread for peer
    const currentUnreads = conversation.unreadCounts.get(recipient._id.toString()) || 0;
    conversation.unreadCounts.set(recipient._id.toString(), currentUnreads + 1);
    await conversation.save();

    await savedMsg.populate('senderId', 'fullName role profilePhoto');

    // Create notification for recipient
    try {
      await createNotification({
        receiverId: recipient._id,
        receiverRole: recipient.role,
        senderId: req.user._id,
        senderRole: req.user.role,
        notificationType: recipient.role === 'borrower' ? 'BorrowerReply' : 'NewMessage',
        title: `New Message from ${req.user.role === 'staff' ? 'Staff' : 'Support'}`,
        message: initialMessage.length > 50 ? initialMessage.substring(0, 47) + '...' : initialMessage,
        relatedId: conversation._id,
        relatedModel: 'Conversation',
        priority: 'normal'
      });
    } catch (notifErr) {
      console.error('Staff controller: Failed to create initial conversation notification:', notifErr);
    }
  }

  // Socket broadcast to the recipient if it's a brand new thread
  try {
    const io = getIO();
    if (isNew) {
      io.emit(`conversationUpdated_${recipient._id}`, { trigger: 'new_thread', conversationId: conversation._id });
    }
    if (savedMsg) {
      // Explicit receiveMessage broadcast
      io.emit(`receiveMessage_${recipient._id}`, savedMsg);
      io.to(conversation._id.toString()).emit('receiveMessage', savedMsg);
    }
  } catch (socketErr) { }

  sendSuccess(res, 'Conversation workspace established', {
    conversationId: conversation._id,
    isNew,
    initialMessage: savedMsg
  });
});

/**
 * @desc    Dispatch a new message in existing thread
 * @route   POST /api/staff/communications/:conversationId/send
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { message, attachment } = req.body;
  const currentUserId = req.user._id.toString();

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return sendError(res, 'Conversation thread target not found', 404);
  }

  const isParticipant = conversation.participants.some(p => p.toString() === currentUserId);
  if (!isParticipant) {
    return sendError(res, 'Unauthorized: user is not member of thread', 403);
  }

  const otherUserId = conversation.participants.find(p => p.toString() !== currentUserId);

  // Support attachments formatting securely
  let attachmentsArr = [];
  if (attachment) {
    attachmentsArr = Array.isArray(attachment) ? attachment : [attachment];
  }

  // Write DB Message
  const newMessage = await Message.create({
    conversationId: conversation._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    receiverId: otherUserId,
    message: message || '',
    messageText: message || '',
    attachments: attachmentsArr,
    attachmentUrl: attachmentsArr[0] || null,
    delivered: true,
    isDelivered: true,
    readBy: [req.user._id]
  });

  // Update tracking in conversation
  conversation.lastMessage = message || 'Attachment shared';
  conversation.lastMessageAt = new Date();
  conversation.lastMessageTime = new Date();

  // Bump unread count for receiver
  if (otherUserId) {
    const recipientKey = otherUserId.toString();
    const currentUnreads = conversation.unreadCounts.get(recipientKey) || 0;
    conversation.unreadCounts.set(recipientKey, currentUnreads + 1);
  }

  await conversation.save();
  await newMessage.populate('senderId', 'fullName role profilePhoto');

  // Formatted socket payload
  const formattedMsg = {
    messageId: newMessage._id.toString(),
    conversationId: newMessage.conversationId.toString(),
    senderId: newMessage.senderId?._id ? newMessage.senderId._id.toString() : newMessage.senderId?.toString(),
    senderName: newMessage.senderId?.fullName || 'System User',
    senderRole: newMessage.senderRole,
    senderPhoto: newMessage.senderId?.profilePhoto || 'no-photo.jpg',
    message: newMessage.message,
    attachments: newMessage.attachments,
    delivered: newMessage.delivered,
    readBy: newMessage.readBy,
    createdAt: newMessage.createdAt
  };

  // Broadcast Real-Time to Socket IO clients
  try {
    const io = getIO();
    // Channel targeted directly at the conversation room
    const roomId = conversationId.toString();
    io.to(roomId).emit('message:received', formattedMsg);
    io.to(roomId).emit('receiveMessage', formattedMsg);
    io.to(roomId).emit('receive_message', formattedMsg); // Compatibility

    // Also broadcast to individual user channels for notifications/sidebar updates
    const receiverId = otherUserId.toString();
    io.emit(`receiveMessage_${receiverId}`, formattedMsg);
    io.emit(`receive_message_${receiverId}`, formattedMsg);

    // Important: Also emit to the sender's own channel so they see it in their sidebar/other tabs
    io.emit(`receiveMessage_${req.user._id}`, formattedMsg);

    // Direct notifications if target not inside the room
    if (otherUserId) {
      io.emit(`receiveMessage_${otherUserId}`, formattedMsg);
      io.emit(`unreadUpdated_${otherUserId}`, { conversationId, unreadCount: conversation.unreadCounts.get(otherUserId.toString()) });
    }

    // Dispatch general sync alert
    io.emit('conversationUpdated', { conversationId, lastMessage: conversation.lastMessage });
  } catch (socketErr) { }

  // Create notification for receiver
  try {
    const receiverUser = await User.findById(otherUserId);
    console.log(`[Communication] Attempting notification for receiver: ${otherUserId}, role: ${receiverUser?.role}`);
    if (receiverUser) {
      await createNotification({
        receiverId: otherUserId,
        receiverRole: receiverUser.role,
        senderId: req.user._id,
        senderRole: req.user.role,
        notificationType: receiverUser.role === 'borrower' ? 'BorrowerReply' : 'NewMessage',
        title: `New Message from ${req.user.role === 'staff' ? 'Staff' : 'Support'}`,
        message: message.length > 50 ? message.substring(0, 47) + '...' : message,
        relatedId: conversation._id,
        relatedModel: 'Conversation',
        priority: 'normal'
      });
    }
  } catch (notifErr) {
    console.error('[Communication] Notification creation failed:', notifErr);
  }

  sendSuccess(res, 'Message dispatched', formattedMsg);
});

/**
 * @desc    Clear unread tallies
 * @route   PUT /api/staff/communications/:conversationId/read
 */
const markConversationRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const currentUserId = req.user._id.toString();

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return sendError(res, 'Conversation thread not found', 404);
  }

  // Reset tracking tallies
  conversation.unreadCounts.set(currentUserId, 0);
  await conversation.save();

  // Update matching incoming unread messages by marking current user in readBy array
  await Message.updateMany(
    { conversationId, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
    {
      $addToSet: { readBy: req.user._id },
      isRead: true
    }
  );

  // Socket emit
  try {
    const io = getIO();
    io.to(conversationId).emit('unreadUpdated', { conversationId, userId: req.user._id, unreadCount: 0 });
  } catch (socketErr) { }

  sendSuccess(res, 'Thread successfully cleared / read updated');
});

/**
 * @desc    Sender deletes their own message
 * @route   DELETE /api/staff/communications/message/:messageId
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const currentUserId = req.user._id.toString();

  const message = await Message.findById(messageId);
  if (!message) {
    return sendError(res, 'Message not found', 404);
  }

  // Authenticate: Only sender can delete own message
  if (message.senderId.toString() !== currentUserId) {
    return sendError(res, 'Unauthorized: You can only delete messages you have authored', 403);
  }

  // Apply Soft Delete to preserve historical DB continuity
  message.isDeleted = true;
  await message.save();

  // Socket broadcast event to sync client views instantly
  try {
    const io = getIO();
    io.to(message.conversationId.toString()).emit('message_deleted', {
      conversationId: message.conversationId,
      messageId: message._id
    });
  } catch (err) { }

  sendSuccess(res, 'Message redacted successfully', { messageId });
});

/**
 * @desc    Retrieves all eligible peers in system
 * @route   GET /api/staff/communications/online-users
 */
const getOnlineUsers = asyncHandler(async (req, res) => {
  // Gather all system actors except the active requester
  const users = await User.find({
    _id: { $ne: req.user._id },
    isDeleted: { $ne: true }
  }).select('fullName role profilePhoto');

  const formattedUsers = users.map(u => ({
    userId: u._id,
    name: u.fullName,
    role: u.role,
    photo: u.profilePhoto || 'no-photo.jpg',
    onlineStatus: 'offline' // Baseline offline; client subscribes to dynamic userOnline status feeds.
  }));

  sendSuccess(res, 'Peer contact list retrieved successfully', formattedUsers);
});

module.exports = {
  getStaffConversations,
  getSingleConversation,
  createNewConversation,
  sendMessage,
  markConversationRead,
  deleteMessage,
  getOnlineUsers
};
